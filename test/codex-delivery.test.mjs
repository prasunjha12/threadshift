import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { prepareCodex, launchCodex } from "../dist/adapters/codex/deliver.js";
import { createReport } from "../dist/pipeline.js";
import { compileSmart } from "../dist/context/smart.js";
import { validBundle } from "./fixtures/bundle.mjs";

const scratch = resolve("work/codex-delivery-tests"); await mkdir(scratch, { recursive: true });
const fixturePath = resolve("test/fixtures/codex-destination.mjs");
async function temporary(t) { const root = await mkdtemp(join(scratch, "case-")); t.after(() => rm(root, { recursive: true, force: true })); return root; }
function spec(root, mode = "success") { return { executable: process.execPath, args: [fixturePath, "exec", "--json", "-"], cwd: root, stdin: "Synthetic continuation", timeoutMs: 5000, env: { THREADSHIFT_CODEX_MODE: mode } }; }

test("Codex delivery requires identity, started/completed turn and zero process exit", async t => {
  const root = await temporary(t);
  const result = await launchCodex(spec(root));
  assert.equal(result.status, "launched");
  assert.equal(result.sessionId, "00000000-0000-4000-8000-000000000001");
});
for (const mode of ["identity-only", "tool-only", "failed-turn", "error-after-success", "conflicting-identity", "missing-id", "unstarted-turn", "malformed-id", "malformed", "nonzero"]) {
  test(`Codex delivery rejects ${mode} and does not retry`, async t => {
    const root = await temporary(t);
    const result = await launchCodex(spec(root, mode));
    assert.equal(result.status, "failed"); assert.equal(result.sessionId, undefined);
  });
}
test("Codex delivery handles timeout and cancellation as failures", async t => {
  const root = await temporary(t);
  assert.equal((await launchCodex({ ...spec(root, "wait"), timeoutMs: 150 })).status, "failed");
  const controller = new AbortController(); const pending = launchCodex(spec(root, "wait"), controller.signal);
  const timer = setTimeout(() => controller.abort(), 100);
  try { assert.equal((await pending).status, "failed"); } finally { clearTimeout(timer); }
});

test("Codex preparation regenerates sanitized context and defaults to context-only stdin", async t => {
  const root = await temporary(t), workspace = join(root, "workspace 雪"); await mkdir(workspace);
  const bundle = validBundle(); bundle.manifest.schemaVersion = 2; bundle.source.harness = "opencode"; bundle.source.runtimeVersion = "2.0.22"; bundle.workspace.root = workspace;
  const secret = "SYNTHETIC_CONTEXT_CREDENTIAL";
  bundle.history.rawRecords[0].value.apiKey = secret;
  const compiled = compileSmart(bundle, { maxCharacters: 24000 });
  const forged = { ...compiled, text: "SYNTHETIC_UNSAFE_PRECOMPILED" };
  const report = createReport(bundle, compiled, "0.162.1", { preparation: "prepared", destination: "codex" });
  const descriptor = { executable: process.execPath, argsPrefix: [fixturePath] };
  const prepared = await prepareCodex(join(root, "package"), bundle, forged, report, descriptor, { overwrite: false });
  assert.deepEqual(prepared.launch.args, [fixturePath, "exec", "--json", "-"]);
  assert.equal(prepared.launch.cwd, workspace);
  assert.equal(prepared.launch.stdin.includes(secret), false);
  assert.equal(prepared.launch.stdin.includes("SYNTHETIC_UNSAFE_PRECOMPILED"), false);
  assert.equal(prepared.launch.stdin.includes('"rawRecords"'), false);
  assert.ok(prepared.launch.stdin.includes(await readFile(prepared.contextPath, "utf8")));
  const saved = JSON.parse(await readFile(prepared.reportPath, "utf8"));
  assert.deepEqual(saved.launchInstructions.stdinFiles, [prepared.contextPath]);
  assert.equal(JSON.stringify(saved).includes(secret), false);
  const attachedReport = createReport(bundle, compiled, "0.162.1", { preparation: "prepared", destination: "codex" });
  const attached = await prepareCodex(join(root, "full-package"), bundle, compiled, attachedReport, descriptor, { overwrite: false, attachBundle: true });
  assert.ok(attached.launch.stdin.includes('"rawRecords"'));
  assert.equal(attached.launch.stdin.includes(secret), false);
  assert.ok(attachedReport.warnings.some(x => x.code === "FULL_BUNDLE_ATTACHMENT"));
  await assert.rejects(prepareCodex(workspace, bundle, compiled, report, descriptor, { overwrite: true }), error => error.code === "INVALID_ARGUMENT");
});

