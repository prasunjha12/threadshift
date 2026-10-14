import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";

let codex;
try {
  codex = await import("../dist/adapters/codex/capture.js");
} catch {
  codex = {};
}
const scratch = join(process.cwd(), "work", "codex-tests");
await mkdir(scratch, { recursive: true });

test("capture accepts the native 0.162.1 array-valued turn page", async () => {
  const { result, root } = await captureFixture("native-shape");
  await rm(root, { recursive: true, force: true });
  assert.equal(result.completeness, "complete");
  assert.equal(result.events.some((event) => event.text?.includes("1 failing test")), true);
});

async function captureFixture(mode = "normal", runtimeVersion = "0.162.1", maxCaptureBytes) {
  const root = await mkdtemp(join(scratch, "case-"));
  const codexHome = join(root, `codex-home-${mode}`);
  await mkdir(codexHome);
  const options = {
    sessionId: "00000000-0000-4000-8000-000000000001",
    executable: process.execPath,
    argsPrefix: ["test/fixtures/codex-server.mjs"],
    codexHome,
    runtimeVersion,
    fixtureMode: mode,
  };
  if (maxCaptureBytes !== undefined) options.maxCaptureBytes = maxCaptureBytes;
  try {
    const result = await codex.captureCodex(options);
    const requests = (await readFile(join(codexHome, "requests.jsonl"), "utf8")).trim().split("\n").map(JSON.parse);
    return { result, requests, root };
  } catch (error) {
    await rm(root, { recursive: true, force: true });
    throw error;
  }
}

test("capture reads selected session twice without resuming or starting a turn", async () => {
  assert.equal(typeof codex.captureCodex, "function");
  const { result, requests, root } = await captureFixture();
  await rm(root, { recursive: true, force: true });
  assert.equal(result.source.sessionId, "00000000-0000-4000-8000-000000000001");
  assert.equal(requests.filter((request) => request.method === "thread/read").length, 2);
  assert.equal(requests.every((request) => request.method !== "thread/read" || request.params.includeTurns !== true), true);
  assert.deepEqual(requests.map((request) => request.method).filter((method) => ["thread/resume", "thread/start", "turn/start"].includes(method)), []);
});

test("capture follows every turn page in both stability passes", async () => {
  const { result, requests, root } = await captureFixture("pagination");
  await rm(root, { recursive: true, force: true });
  assert.equal(result.completeness, "complete");
  assert.equal(result.events.some((event) => event.text?.includes("Second page 雪")), true);
  const pages = requests.filter((request) => request.method === "thread/turns/list");
  assert.equal(pages.length, 4);
  assert.equal(pages.every((request) => request.params.itemsView === "full"), true);
});

test("capture rejects malformed or looping pagination rather than claiming completeness", async () => {
  await assert.rejects(captureFixture("missing-cursor"), (error) => error.code === "CODEX_PROTOCOL");
  await assert.rejects(captureFixture("cursor-loop"), (error) => error.code === "CODEX_PROTOCOL");
});

test("capture preserves tool history and unknown items while excluding private reasoning content", async () => {
  assert.equal(typeof codex.captureCodex, "function");
  const { result, root } = await captureFixture();
  await rm(root, { recursive: true, force: true });
  assert.deepEqual(result.events.map((event) => event.kind), ["user", "assistant", "tool-call", "tool-result", "plan", "unknown", "unknown"]);
  assert.equal(result.events[2].callId, result.events[3].callId);
  assert.equal(result.events[3].text.includes("1 failing test"), true);
  assert.equal(result.rawRecords.some((record) => JSON.stringify(record.value).includes("preserve me")), true);
  const reasoning = result.rawRecords.find((record) => JSON.stringify(record.value).includes("reasoning-1"));
  assert.equal(JSON.stringify(reasoning.value).includes("private reasoning detail"), false);
  assert.equal(JSON.stringify(reasoning.value).includes("Private reasoning summary"), false);
  assert.equal(result.exclusions.includes("reasoning.content"), true);
  assert.equal(result.warnings.some((warning) => warning.code === "REASONING_CONTENT_EXCLUDED"), true);
});

test("capture rejects an active source session", async () => {
  assert.equal(typeof codex.captureCodex, "function");
  await assert.rejects(captureFixture("active"), (error) => error.code === "SOURCE_ACTIVE");
});

test("capture rejects a source whose records change between reads", async () => {
  assert.equal(typeof codex.captureCodex, "function");
  await assert.rejects(captureFixture("changing"), (error) => error.code === "SOURCE_CHANGED");
});

test("capture rejects a malformed source response without calling it complete", async () => {
  assert.equal(typeof codex.captureCodex, "function");
  await assert.rejects(captureFixture("malformed"), (error) => error.code === "CODEX_PROTOCOL");
});

test("capture rejects Codex versions without a verified adapter contract", async () => {
  assert.equal(typeof codex.captureCodex, "function");
  await assert.rejects(captureFixture("normal", "0.162.2"), (error) => error.code === "UNSUPPORTED_RUNTIME");
});

test("capture fails instead of truncating history beyond the configured input limit", async () => {
  assert.equal(typeof codex.captureCodex, "function");
  await assert.rejects(captureFixture("normal", "0.162.1", 100), (error) => error.code === "CAPTURE_TOO_LARGE");
});
