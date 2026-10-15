import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { validBundle } from "./fixtures/bundle.mjs";
import { compileSmart } from "../dist/context/smart.js";
let api = {};
try {
  api = await import("../dist/adapters/pi/deliver.js");
} catch {}
const fixture = resolve("test/fixtures/pi-destination.mjs");
const spec = (mode) => ({
  executable: process.execPath,
  args: [fixture, "--mode", "json"],
  cwd: process.cwd(),
  stdin: "Unicode 雪\u2028\u2029",
  timeoutMs: 10000,
  env: { ...process.env, PI_TEST_MODE: mode },
});
test("Pi requires settled success", async () => {
  assert.equal(typeof api.launchPi, "function");
  for (const mode of [
    "header",
    "unsettled",
    "conflict",
    "late-turn",
    "late-error",
    "aborted",
    "missing-final",
    "pending-tool",
    "truncated",
    "nonzero",
  ]) {
    const r = await api.launchPi(spec(mode));
    assert.equal(r.status, "failed", mode);
    assert.equal(r.sessionId, undefined);
    assert.equal(JSON.stringify(r).includes("PRIVATE_NATIVE_ERROR"), false);
  }
  for (const mode of ["success", "unicode", "recovery"]) {
    const r = await api.launchPi(spec(mode));
    assert.equal(r.status, "launched", mode);
    if (mode === "recovery")
      assert.ok(r.warnings.some((w) => w.code === "PI_AUTOMATIC_RECOVERY"));
  }
});
test("Pi launch never retries on failure", async () => {
  assert.equal(typeof api.launchPi, "function");
  const root = await mkdtemp(resolve("work/pi-delivery-"));
  const log = join(root, "log");
  const s = spec("late-error");
  s.env.PI_TEST_LOG = log;
  await api.launchPi(s);
  assert.equal((await readFile(log, "utf8")).trim().split("\n").length, 1);
});
test("Pi preparation uses fresh stdin-only invocation and regenerated persisted context", async () => {
  assert.equal(typeof api.preparePi, "function");
  const root = await mkdtemp(resolve("work/pi-prepare-"));
  const workspace = join(root, "workspace");
  await mkdir(workspace);
  const b = validBundle();
  b.workspace.root = workspace;
  const report = { warnings: [] };
  const result = await api.preparePi(
    join(root, "package"),
    b,
    {
      ...compileSmart(b, { maxCharacters: 24000 }),
      text: "FORGED_PRECOMPILED",
    },
    report,
    { executable: process.execPath, argsPrefix: [fixture] },
    { overwrite: false, workspaceRoot: workspace },
  );
  assert.deepEqual(result.launch.args, [fixture, "--mode", "json"]);
  assert.equal(result.launch.stdin.includes("FORGED_PRECOMPILED"), false);
  assert.ok(result.launch.stdin.includes("Fix the parser"));
  assert.equal(result.launch.stdin.includes('"rawRecords"'), false);
  assert.deepEqual(report.launchInstructions.stdinFiles, [result.contextPath]);
});
