import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

let runtime;
try {
  runtime = await import("../dist/runtime/process.js");
} catch {
  runtime = {};
}

const tempDirs = [];
test.after(async () => Promise.all(tempDirs.map((path) => rm(path, { recursive: true, force: true }))));

async function temporaryDirectory() {
  const path = await mkdtemp(join(tmpdir(), "threadshift-runtime-"));
  tempDirs.push(path);
  return path;
}

test("runProcess passes shell characters and Unicode as literal arguments", async () => {
  assert.equal(typeof runtime.runProcess, "function");
  const args = ["space name", "雪", "$(touch never)", "a&b", "quote'\"`$x"];
  const result = await runtime.runProcess({
    executable: process.execPath,
    args: ["test/fixtures/process-child.mjs", "args", ...args],
    cwd: process.cwd(),
    timeoutMs: 3_000,
  });
  assert.equal(result.exitCode, 0);
  assert.deepEqual(JSON.parse(result.stdout), args);
});

test("runProcess kills a child when its deadline expires", async () => {
  const started = Date.now();
  await assert.rejects(
    runtime.runProcess({
      executable: process.execPath,
      args: ["test/fixtures/process-child.mjs", "sleep"],
      cwd: process.cwd(),
      timeoutMs: 100,
    }),
    (error) => error.code === "PROCESS_TIMEOUT",
  );
  assert.ok(Date.now() - started < 3_000);
});

test("runProcess kills a child when cancelled", async () => {
  const controller = new AbortController();
  const pending = runtime.runProcess({
    executable: process.execPath,
    args: ["test/fixtures/process-child.mjs", "sleep"],
    cwd: process.cwd(),
    timeoutMs: 3_000,
  }, controller.signal);
  setTimeout(() => controller.abort(), 50).unref();
  await assert.rejects(pending, (error) => error.code === "PROCESS_CANCELLED");
});

test("runProcess reports a missing executable as a stable error", async () => {
  await assert.rejects(
    runtime.runProcess({ executable: join(process.cwd(), "missing-binary"), args: [], cwd: process.cwd(), timeoutMs: 100 }, undefined),
    (error) => error.code === "EXECUTABLE_NOT_FOUND",
  );
});

test("resolveHarness unwraps a standard Windows npm PowerShell shim", async () => {
  const directory = await temporaryDirectory();
  const shim = join(directory, "codex.ps1");
  await writeFile(shim, [
    "$basedir=Split-Path $MyInvocation.MyCommand.Definition -Parent",
    'if (Test-Path "$basedir/node.exe") { & "$basedir/node.exe" "$basedir/node_modules/@openai/codex/bin/codex.js" $args } else { & "node" "$basedir/node_modules/@openai/codex/bin/codex.js" $args }',
    "exit $LASTEXITCODE",
  ].join("\n"));
  const descriptor = await runtime.resolveHarness("codex", shim);
  assert.equal(descriptor.executable, process.execPath);
  assert.deepEqual(descriptor.argsPrefix, [join(directory, "node_modules", "@openai", "codex", "bin", "codex.js")]);
});

test("npm PowerShell shim keeps its script when colocated Node exists", async () => {
  const directory = await temporaryDirectory();
  const shim = join(directory, "codex.ps1");
  await writeFile(join(directory, "node.exe"), "fixture executable presence");
  await writeFile(shim, '& "$basedir/node.exe" "$basedir/node_modules/@openai/codex/bin/codex.js" $args');
  const descriptor = await runtime.resolveHarness("codex", shim);
  assert.deepEqual(descriptor.argsPrefix, [join(directory, "node_modules", "@openai", "codex", "bin", "codex.js")]);
});

test("resolveHarness unwraps the native OpenCode npm executable shim", async () => {
  const directory = await temporaryDirectory();
  const executable = join(directory, "node_modules", "@opencode", "cli", "bin", "opencode.exe");
  await mkdir(join(directory, "node_modules", "@opencode", "cli", "bin"), { recursive: true });
  await writeFile(executable, "fixture executable presence");
  const shim = join(directory, "opencode.ps1");
  await writeFile(shim, '& "$basedir/node_modules/@opencode/cli/bin/opencode.exe" $args');
  assert.deepEqual(await runtime.resolveHarness("opencode", shim), { executable, argsPrefix: [], wrapperPath: shim });
});

test("timeout terminates descendants and a parent that ignores termination", async (t) => {
  const directory = await temporaryDirectory();
  const pidFile = join(directory, "tree.json");
  let ids;
  t.after(() => {
    for (const pid of ids ?? []) { try { process.kill(pid, "SIGKILL"); } catch {} }
  });
  const pending = runtime.runProcess({
    executable: process.execPath, args: [join(process.cwd(), "test/fixtures/process-child.mjs"), "tree", pidFile],
    cwd: process.cwd(), timeoutMs: 800,
  });
  pending.catch(() => {});
  for (let attempt = 0; attempt < 100; attempt++) {
    try { ids = JSON.parse(await readFile(pidFile, "utf8")); break; } catch { await new Promise((r) => setTimeout(r, 10)); }
  }
  assert.ok(ids);
  await assert.rejects(Promise.race([
    pending, new Promise((_, reject) => setTimeout(() => reject(new Error("termination did not finish")), 2000)),
  ]), (error) => error.code === "PROCESS_TIMEOUT");
  for (const pid of ids) assert.throws(() => process.kill(pid, 0), (error) => error.code === "ESRCH");
});
