import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const scratch = join(process.cwd(), "work", "cli-tests");
await mkdir(scratch, { recursive: true });
const cliPath = resolve("dist/cli.js");
const codexFixture = resolve("test/fixtures/codex-server.mjs");
const opencodeFixture = resolve("test/fixtures/opencode-server.mjs");
const sessionId = "00000000-0000-4000-8000-000000000001";

async function runCli(args, env = {}) {
  const child = spawn(process.execPath, [cliPath, ...args], {
    cwd: process.cwd(),
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  const exitCode = await new Promise((resolveExit, reject) => {
    child.once("error", reject);
    child.once("close", resolveExit);
  });
  return { exitCode, stdout, stderr };
}

async function setup(t) {
  const root = await mkdtemp(join(scratch, "run-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const workspace = join(root, "workspace 雪");
  const codexHome = join(root, "codex-home-normal");
  const output = join(root, "handoff output 雪");
  await mkdir(workspace, { recursive: true });
  await mkdir(codexHome, { recursive: true });
  await writeFile(join(workspace, "parser.ts"), "export const parse = () => true;\n");
  execFileSync("git", ["init", "--quiet"], { cwd: workspace });
  execFileSync("git", ["config", "user.name", "ThreadShift Test"], { cwd: workspace });
  execFileSync("git", ["config", "user.email", "test@example.invalid"], { cwd: workspace });
  execFileSync("git", ["add", "--", "parser.ts"], { cwd: workspace });
  execFileSync("git", ["commit", "--quiet", "-m", "initial"], { cwd: workspace });
  const args = [
    "handoff", "--from", "codex", "--to", "opencode", "--session", sessionId,
    "--workspace", workspace, "--output", output,
    "--codex-bin", codexFixture, "--opencode-bin", opencodeFixture, "--codex-home", codexHome,
  ];
  return { root, workspace, codexHome, output, args };
}

test("handoff defaults to Smart and dry-run writes no package files", async (t) => {
  const { output, args } = await setup(t);
  const result = await runCli([...args, "--dry-run", "--json"]);
  assert.equal(result.exitCode, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.mode, "smart");
  assert.equal(report.preparation, "dry-run");
  await assert.rejects(stat(output), (error) => error.code === "ENOENT");
});

test("unsupported modes are rejected with Smart identified as the implemented mode", async (t) => {
  const { args } = await setup(t);
  const result = await runCli([...args, "--mode", "full", "--dry-run"]);
  assert.notEqual(result.exitCode, 0);
  assert.match(result.stderr, /Smart.*implemented|implemented.*Smart/i);
});

test("prepared handoff archives the bundle and selects context from the workspace", async (t) => {
  const { workspace, output, args } = await setup(t);
  const result = await runCli([...args, "--json"]);
  assert.equal(result.exitCode, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.preparation, "prepared");
  const files = await readdir(output);
  assert.deepEqual(files.sort(), ["continuation.md", "report.json", "session.threadshift.json"]);
  const content = await readFile(join(output, "continuation.md"), "utf8");
  assert.match(content, /Fix parser|User request/i);
  assert.equal(report.outputPaths.bundle, join(output, "session.threadshift.json"));
  assert.equal(report.outputPaths.context, join(output, "continuation.md"));
});

test("explicit launch records OpenCode session identity and literal file paths", async (t) => {
  const { workspace, output, args } = await setup(t);
  const logPath = join(dirnameForTest(output), "opencode.jsonl");
  const result = await runCli([...args, "--launch", "--json"], { OPENCODE_TEST_LOG: logPath });
  assert.equal(result.exitCode, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.deepEqual(report.launch, { status: "launched", sessionId: "ses_fixture", exitCode: 0 });
  const written = JSON.parse(await readFile(join(output, "report.json"), "utf8"));
  assert.equal(written.launch.sessionId, "ses_fixture");
  const invocation = JSON.parse((await readFile(logPath, "utf8")).trim());
  assert.equal(invocation.cwd, workspace);
  assert.equal(invocation.argv.filter((argument) => argument === "--file").length, 1);
  assert.equal(invocation.argv.includes(join(output, "session.threadshift.json")), false);
});

test("full sanitized bundle attachment requires explicit CLI choice", async (t) => {
  const { root, output, args } = await setup(t);
  const logPath = join(root, "full-attachment.jsonl");
  const result = await runCli([...args, "--attach-bundle", "--launch", "--json"], { OPENCODE_TEST_LOG: logPath });
  assert.equal(result.exitCode, 0, result.stderr + result.stdout);
  const invocation = JSON.parse((await readFile(logPath, "utf8")).trim());
  assert.equal(invocation.argv.includes(join(output, "session.threadshift.json")), true);
  assert.equal(JSON.parse(result.stdout).warnings.some((item) => item.code === "FULL_BUNDLE_ATTACHMENT"), true);
});

test("unchanged ordinary documentation mentioning .env imports without a mismatch", async (t) => {
  const { root, workspace, output, args } = await setup(t);
  await writeFile(join(workspace, "README.md"), "Initial setup\n");
  execFileSync("git", ["add", "README.md"], { cwd: workspace });
  execFileSync("git", ["commit", "--quiet", "-m", "setup instructions"], { cwd: workspace });
  await writeFile(join(workspace, "README.md"), "Set up .env for development\n");
  const prepared = await runCli([...args, "--json"]);
  assert.equal(prepared.exitCode, 0, prepared.stderr + prepared.stdout);
  const imported = await runCli(["import", "--bundle", join(output, "session.threadshift.json"), "--to", "opencode", "--opencode-bin", opencodeFixture, "--output", join(root, "imported"), "--dry-run", "--json"]);
  assert.equal(imported.exitCode, 0, imported.stderr + imported.stdout);
});

test("launch failure retains the prepared bundle and reports failure", async (t) => {
  const { output, args } = await setup(t);
  const result = await runCli([...args, "--launch", "--json"], { OPENCODE_FIXTURE_MODE: "fail" });
  assert.notEqual(result.exitCode, 0);
  assert.equal((await readdir(output)).includes("session.threadshift.json"), true);
  const report = JSON.parse(await readFile(join(output, "report.json"), "utf8"));
  assert.equal(report.launch.status, "failed");
  assert.equal(report.preparation, "prepared");
});

test("dry-run and launch cannot be combined", async (t) => {
  const { args } = await setup(t);
  const result = await runCli([...args, "--dry-run", "--launch"]);
  assert.notEqual(result.exitCode, 0);
  assert.match(result.stderr, /cannot be used together/i);
});

test("an output package inside the workspace is disclosed", async (t) => {
  const { workspace, args } = await setup(t);
  const output = join(workspace, "threadshift handoff");
  const withoutOutput = args.filter((arg, index) => arg !== "--output" && args[index - 1] !== "--output");
  const result = await runCli([...withoutOutput, "--output", output, "--dry-run", "--json"]);
  assert.equal(result.exitCode, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.warnings.some((warning) => warning.code === "OUTPUT_INSIDE_WORKSPACE"), true);
});

test("output files inside the workspace are ignored during the final snapshot check", async (t) => {
  const { workspace, args } = await setup(t);
  const output = join(workspace, "threadshift handoff");
  const withoutOutput = args.filter((arg, index) => arg !== "--output" && args[index - 1] !== "--output");
  const result = await runCli([...withoutOutput, "--output", output, "--launch", "--json"]);
  assert.equal(result.exitCode, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.launch.status, "launched");
  assert.equal(report.warnings.some((warning) => warning.code === "OUTPUT_INSIDE_WORKSPACE"), true);
});

test("export writes the canonical bundle without requiring a destination", async (t) => {
  const { root, workspace, codexHome, args } = await setup(t);
  const bundlePath = join(root, "saved.threadshift.json");
  const exportArgs = [
    "export", "--from", "codex", "--session", sessionId,
    "--workspace", workspace, "--output", bundlePath,
    "--codex-bin", codexFixture, "--codex-home", codexHome, "--json",
  ];
  const result = await runCli(exportArgs);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).status, "exported");
  assert.equal(JSON.parse(await readFile(bundlePath, "utf8")).manifest.schemaVersion, 1);
});

test("import blocks workspace mismatches unless the user explicitly accepts them", async (t) => {
  const { root, workspace, codexHome } = await setup(t);
  const bundlePath = join(root, "saved.threadshift.json");
  const exportArgs = [
    "export", "--from", "codex", "--session", sessionId,
    "--workspace", workspace, "--output", bundlePath,
    "--codex-bin", codexFixture, "--codex-home", codexHome,
  ];
  const exported = await runCli(exportArgs);
  assert.equal(exported.exitCode, 0, exported.stderr);
  await writeFile(join(workspace, "parser.ts"), "export const changedAfterExport = true;\n");
  const importArgs = [
    "import", "--bundle", bundlePath, "--to", "opencode", "--workspace", workspace,
    "--opencode-bin", opencodeFixture, "--output", join(root, "imported"), "--dry-run", "--json",
  ];
  const blocked = await runCli(importArgs);
  assert.notEqual(blocked.exitCode, 0);
  assert.match(blocked.stdout, /WORKSPACE_MISMATCH/);
  const accepted = await runCli([...importArgs, "--accept-workspace-mismatch"]);
  assert.equal(accepted.exitCode, 0, accepted.stderr);
  const report = JSON.parse(accepted.stdout);
  assert.equal(report.warnings.some((warning) => warning.code === "WORKSPACE_MISMATCH_ACCEPTED"), true);
});

test("handoff requires explicit source session identity", async () => {
  const result = await runCli(["handoff", "--from", "codex", "--to", "opencode", "--dry-run"]);
  assert.notEqual(result.exitCode, 0);
  assert.match(result.stderr, /--session <id> is required/);
});

function dirnameForTest(path) {
  return resolve(path, "..");
}

test("physical output aliases cannot replace a workspace", async (t) => {
  const { root, workspace, args } = await setup(t);
  const alias = join(root, "alias");
  try {
    await symlink(root, alias, process.platform === "win32" ? "junction" : "dir");
  } catch (error) {
    if (!process.env.CI && ["EPERM", "ENOTSUP"].includes(error.code)) { t.skip("OS sandbox does not allow junction/symlink creation; real CI must exercise this test"); return; }
    throw error;
  }
  const withoutOutput = args.filter((arg, index) => arg !== "--output" && args[index - 1] !== "--output");
  const result = await runCli([...withoutOutput, "--output", join(alias, "workspace 雪"), "--overwrite", "--dry-run", "--json"]);
  assert.notEqual(result.exitCode, 0);
  assert.match(result.stdout, /cannot replace/);
  await stat(join(workspace, "parser.ts"));
});

test("supplied known credentials are redacted in bundle context and warnings", async (t) => {
  const { root, output, args } = await setup(t);
  const fields = join(root, "fields.json");
  const credential = "sk-proj-abcdefghijklmnop";
  await writeFile(fields, JSON.stringify({ objective: "Use " + credential }));
  const result = await runCli([...args, "--handoff-file", fields, "--json"]);
  assert.equal(result.exitCode, 0, result.stderr);
  const bundle = await readFile(join(output, "session.threadshift.json"), "utf8");
  const context = await readFile(join(output, "continuation.md"), "utf8");
  assert.equal(bundle.includes(credential), false);
  assert.equal(context.includes(credential), false);
  assert.equal(JSON.parse(result.stdout).warnings.some((warning) => warning.code === "CREDENTIALS_REDACTED"), true);
});

test("dry-run refuses a missing Codex home without creating it", async (t) => {
  const { root, args } = await setup(t);
  const missing = join(root, "codex-home-missing");
  const withoutHome = args.filter((arg, index) => arg !== "--codex-home" && args[index - 1] !== "--codex-home");
  const result = await runCli([...withoutHome, "--codex-home", missing, "--dry-run", "--json"]);
  assert.notEqual(result.exitCode, 0);
  await assert.rejects(stat(missing), (error) => error.code === "ENOENT");
});

test("handoff cannot replace the workspace directory even with overwrite", async (t) => {
  const { workspace, args } = await setup(t);
  const withoutOutput = args.filter((arg, index) => arg !== "--output" && args[index - 1] !== "--output");
  const result = await runCli([...withoutOutput, "--output", workspace, "--overwrite", "--json"]);
  assert.notEqual(result.exitCode, 0);
  assert.match(result.stdout, /cannot replace the workspace/);
  assert.match(await readFile(join(workspace, "parser.ts"), "utf8"), /parse/);
});

test("destination error events fail even with a zero exit code", async (t) => {
  const { output, args } = await setup(t);
  const result = await runCli([...args, "--launch", "--json"], { OPENCODE_FIXTURE_MODE: "error-event" });
  assert.notEqual(result.exitCode, 0);
  const report = JSON.parse(await readFile(join(output, "report.json"), "utf8"));
  assert.equal(report.launch.status, "failed");
});

test("cancelled destination stops its child and retains prepared outputs", async (t) => {
  const { output, args } = await setup(t);
  assert.equal((await runCli(args)).exitCode, 0);
  const { launchOpenCode } = await import("../dist/adapters/opencode/deliver.js");
  const controller = new AbortController();
  const pidFile = join(output, "child.pid");
  const pending = launchOpenCode({
    executable: process.execPath, args: [opencodeFixture], cwd: process.cwd(),
    env: { OPENCODE_FIXTURE_MODE: "delay", OPENCODE_PID_FILE: pidFile },
    timeoutMs: 5000,
  }, controller.signal);
  for (let attempt = 0; attempt < 100; attempt++) {
    try { await stat(pidFile); break; } catch { await new Promise((r) => setTimeout(r, 20)); }
  }
  const pid = Number(await readFile(pidFile, "utf8"));
  controller.abort();
  const result = await pending;
  assert.equal(result.status, "failed");
  assert.match(result.error, /cancelled/);
  assert.throws(() => process.kill(pid, 0), (error) => error.code === "ESRCH");
  await stat(join(output, "session.threadshift.json"));
});
