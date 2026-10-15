import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { captureOpenCode } from "../dist/adapters/opencode/capture.js";
import { readOpenCodeSnapshot } from "../dist/adapters/opencode/protocol.js";

const contract = JSON.parse(await readFile(new URL("./fixtures/opencode-native-contract.json", import.meta.url), "utf8"));
const scratch = resolve("work/opencode-tests"); await mkdir(scratch, { recursive: true });
async function fixture(t, mode = "normal", overrides = {}) {
  const root = await mkdtemp(join(scratch, "case-")); t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, "source-fixture.json"), JSON.stringify({ data: contract, mode, ...overrides }));
  return { root, options: { sessionId: contract.info.id, cwd: root, executable: resolve("test/fixtures/opencode-source.mjs") } };
}

test("OpenCode capture follows every unfiltered page twice with exact safe inventory", async t => {
  const { root, options } = await fixture(t);
  const result = await captureOpenCode(options);
  assert.equal(result.completeness, "complete");
  assert.equal(result.source.harness, "opencode");
  assert.equal(result.rawRecords.length, 7);
  assert.equal(result.rawRecords.filter(x => /\/content\//.test(x.sourceLocator)).length, 3);
  assert.equal(result.events.find(x => x.kind === "tool-call").callId, result.events.find(x => x.kind === "tool-result").callId);
  assert.match(result.events.find(x => x.kind === "tool-result").text, /1 test failed/);
  assert.equal(JSON.stringify(result).includes("SYNTHETIC_REASONING_EXCLUDED"), false);
  const calls = (await readFile(join(root, "requests.jsonl"), "utf8")).trim().split(/\r?\n/).map(JSON.parse);
  assert.equal(calls.filter(x => x.path.endsWith("/message")).length, 8);
  assert.equal(calls.filter(x => !x.path.endsWith("/message")).length, 2);
  assert.ok(calls.every(x => x.method === "GET" && x.path.startsWith(`/api/session/${contract.info.id}`)));
  assert.ok(calls.every(x => !x.query.cursor || x.query.order === undefined));
  assert.equal((await readFile(join(root, "source-fixture.json"), "utf8")).includes("SYNTHETIC_REASONING_EXCLUDED"), true);
});

for (const [mode, code] of [["active", "SOURCE_ACTIVE"], ["running-tool", "SOURCE_ACTIVE"], ["changed", "SOURCE_CHANGED"], ["wrong-session", "OPENCODE_PROTOCOL"], ["wrong-workspace", "WORKSPACE_MISMATCH"], ["duplicate", "OPENCODE_PROTOCOL"], ["cursor-loop", "OPENCODE_PROTOCOL"], ["missing-cursor", "OPENCODE_PROTOCOL"], ["malformed", "OPENCODE_PROTOCOL"], ["malformed-part", "OPENCODE_PROTOCOL"], ["remote-url", "OPENCODE_PROTOCOL"], ["redirect", "OPENCODE_PROTOCOL"], ["early-exit", "OPENCODE_PROTOCOL"]]) {
  test(`OpenCode capture rejects ${mode} without claiming complete history`, async t => {
    const { options } = await fixture(t, mode);
    await assert.rejects(captureOpenCode(options), error => error.code === code);
  });
}

test("unknown OpenCode content and result-only records retain valid raw attribution", async t => {
  for (const mode of ["unknown", "orphan"]) {
    const { options } = await fixture(t, mode);
    const result = await captureOpenCode(options);
    assert.ok(result.events.some(x => x.kind === "unknown"));
    assert.ok(result.rawRecords.some(x => JSON.stringify(x.value).includes(mode === "unknown" ? "preserve me" : "orphan result")));
    assert.ok(result.warnings.some(x => x.code === "UNKNOWN_EVENT_PRESERVED"));
  }
});

test("unverified boundary or fork history stays incomplete", async t => {
  for (const mode of ["unknown-boundary", "fork", "unknown-tool-state"]) {
    const { options } = await fixture(t, mode);
    const result = await captureOpenCode(options);
    assert.equal(result.completeness, "incomplete");
    assert.ok(result.warnings.length > 0);
  }
});

test("equal timestamps retain native message order and immediate read cancellation is honored", async t => {
  const { options } = await fixture(t, "tied-time");
  const result = await captureOpenCode(options);
  const locators = result.rawRecords.filter(x => /\/message\/[^/]+$/.test(x.sourceLocator)).map(x => x.value.id);
  assert.deepEqual(locators, contract.messages.map(x => x.id));
  const controller = new AbortController();
  const pending = readOpenCodeSnapshot(options, controller.signal); controller.abort();
  await assert.rejects(pending, error => error.code === "PROCESS_CANCELLED");
});

test("OpenCode capture excludes inline media and never follows file URLs", async t => {
  const { root, options } = await fixture(t, "media");
  const result = await captureOpenCode(options);
  assert.equal(JSON.stringify(result).includes("SYNTHETIC_INLINE_MEDIA"), false);
  assert.ok(result.exclusions.includes("media.content"));
  assert.doesNotMatch(await readFile(join(root, "requests.jsonl"), "utf8"), /example\.invalid/);
});

test("capture checks version, byte bounds, cancellation and timeout", async t => {
  const unsupported = await fixture(t, "normal", { version: "2.0.23" });
  await assert.rejects(captureOpenCode(unsupported.options), error => error.code === "UNSUPPORTED_RUNTIME");
  const large = await fixture(t, "oversize");
  await assert.rejects(captureOpenCode({ ...large.options, maxCaptureBytes: 4096 }), error => error.code === "CAPTURE_TOO_LARGE");
  const stalled = await fixture(t, "stall");
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 300);
  try { await assert.rejects(captureOpenCode(stalled.options, controller.signal), error => error.code === "PROCESS_CANCELLED"); } finally { clearTimeout(timer); }
  await assert.rejects(captureOpenCode({ ...stalled.options, timeoutMs: 300 }), error => error.code === "PROCESS_TIMEOUT");
});

test("malformed terminal timestamps and unknown shell/compaction states cannot claim complete", async t => {
  for(const mode of ["null-completed","string-completed","unknown-shell-state","unknown-compaction-state"]){
    const {options}=await fixture(t,mode);const capture=await captureOpenCode(options);assert.equal(capture.completeness,"incomplete",mode);
  }
});

test("completed result without native input never invents a tool call", async t => {
  const {options}=await fixture(t,"missing-tool-input");const capture=await captureOpenCode(options);
  assert.equal(capture.events.some(x=>x.kind==="tool-call"),false);assert.ok(capture.events.some(x=>x.kind==="unknown"));assert.ok(capture.warnings.some(x=>x.code==="UNKNOWN_EVENT_PRESERVED"));assert.ok(capture.rawRecords.some(x=>JSON.stringify(x.value).includes("1 test failed")));
});
