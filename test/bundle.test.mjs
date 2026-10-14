import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { validBundle } from "./fixtures/bundle.mjs";

let core;
try {
  core = await import("../dist/core/index.js");
} catch {
  core = {};
}
const scratch = join(process.cwd(), "work", "bundle-tests");
await mkdir(scratch, { recursive: true });
const root = await mkdtemp(join(scratch, "case-"));
test.after(() => rm(root, { recursive: true, force: true }));

test("validated bundle round trip preserves unknown raw records and order", () => {
  assert.equal(typeof core.validateBundle, "function");
  const bundle = validBundle();
  bundle.history.rawRecords.push({ id: "raw-unknown", value: { futureEvent: { any: [1, "雪"] } }, sourceLocator: "future" });
  bundle.manifest.counts.rawRecords = 2;
  const restored = core.validateBundle(JSON.parse(JSON.stringify(bundle)));
  assert.deepEqual(restored.history.rawRecords[1], bundle.history.rawRecords[1]);
  assert.deepEqual(restored.history.events.map((event) => event.order), [0]);
});

test("bundle validation rejects unsupported schemas, false counts, and dangling raw links", () => {
  assert.equal(typeof core.validateBundle, "function");
  for (const mutate of [
    (bundle) => { bundle.manifest.schemaVersion = 2; },
    (bundle) => { bundle.manifest.counts.events = 2; },
    (bundle) => { bundle.history.events[0].rawRecordIds = ["missing"]; },
  ]) {
    const bundle = validBundle();
    mutate(bundle);
    assert.throws(() => core.validateBundle(bundle), (error) => error.code === "INVALID_BUNDLE");
  }
});

test("credential redaction marks nested secrets and preserves event identity", () => {
  assert.equal(typeof core.redactRecord, "function");
  const input = { id: "event-42", nested: { apiKey: "sk-proj-examplesecret123", note: "normal text" } };
  const result = core.redactRecord(input);
  assert.equal(result.value.id, "event-42");
  assert.match(result.value.nested.apiKey, /^\[REDACTED:/);
  assert.equal(result.value.nested.note, "normal text");
  assert.equal(result.warnings.length, 1);
  assert.equal(input.nested.apiKey, "sk-proj-examplesecret123");
});

test("bundle writing refuses an existing target without changing it", async () => {
  assert.equal(typeof core.writeBundle, "function");
  const path = join(root, "session.threadshift.json");
  await writeFile(path, "keep-me");
  await assert.rejects(core.writeBundle(path, validBundle(), { overwrite: false }), (error) => error.code === "OUTPUT_EXISTS");
  assert.equal(await readFile(path, "utf8"), "keep-me");
});

test("bundle writing leaves no partial file when serialization fails", async () => {
  assert.equal(typeof core.writeBundle, "function");
  const path = join(root, "partial.threadshift.json");
  const bundle = validBundle();
  bundle.history.rawRecords[0].value = { cyclic: null };
  bundle.history.rawRecords[0].value.cyclic = bundle.history.rawRecords[0].value;
  await assert.rejects(core.writeBundle(path, bundle, { overwrite: false }));
  await assert.rejects(readFile(path), (error) => error.code === "ENOENT");
});

test("package writing stages bundle, context and report as one handoff", async () => {
  assert.equal(typeof core.writePackage, "function");
  const directory = join(root, "prepared");
  const bundle = validBundle();
  const context = { text: "Continue the parser task", characterCount: 27, selectedEventIds: ["event-1"], omittedEventIds: [], warnings: [] };
  const report = { source: { harness: "codex", sessionId: "session-1", runtimeVersion: "0.162.1" }, destination: { harness: "opencode", runtimeVersion: "2.0.22" }, mode: "smart", completeness: "complete", preservedCounts: { events: 1, rawRecords: 1 }, selectedCounts: { events: 1 }, workspaceDigest: "sha256:workspace", warnings: [], preparation: "prepared" };
  const prepared = await core.writePackage(directory, bundle, context, report, { overwrite: false });
  assert.equal(prepared.bundlePath, join(directory, "session.threadshift.json"));
  assert.match(await readFile(join(directory, "continuation.md"), "utf8"), /Fix the parser/);
  assert.equal(JSON.parse(await readFile(join(directory, "report.json"), "utf8")).mode, "smart");
  assert.equal(JSON.parse(await readFile(prepared.bundlePath, "utf8")).history.events[0].id, "event-1");
});

test("failed replacement keeps the previous complete package", async () => {
  assert.equal(typeof core.writePackage, "function");
  const directory = join(root, "replace-me");
  await mkdir(directory);
  await writeFile(join(directory, "sentinel.txt"), "old-package");
  const report = { text: "bad" };
  report.self = report;
  await assert.rejects(core.writePackage(directory, validBundle(), { text: "new context", characterCount: 12, selectedEventIds: [], omittedEventIds: [], warnings: [] }, report, { overwrite: true }));
  assert.equal(await readFile(join(directory, "sentinel.txt"), "utf8"), "old-package");
});

test("package persistence cannot overwrite its workspace even without the CLI", async () => {
  const directory = join(root, "protected-workspace");
  await mkdir(directory);
  await writeFile(join(directory, "sentinel.txt"), "keep workspace");
  const bundle = validBundle();
  bundle.workspace.root = directory;
  const context = { text: "context", characterCount: 7, selectedEventIds: [], omittedEventIds: [], warnings: [] };
  await assert.rejects(core.writePackage(directory, bundle, context, {}, { overwrite: true }), (error) => error.code === "INVALID_ARGUMENT");
  assert.equal(await readFile(join(directory, "sentinel.txt"), "utf8"), "keep workspace");
});

test("package persistence cannot overwrite a directory containing its input", async () => {
  const directory = join(root, "protected-input");
  await mkdir(directory);
  const input = join(directory, "input.threadshift.json");
  await writeFile(input, "keep input");
  const context = { text: "context", characterCount: 7, selectedEventIds: [], omittedEventIds: [], warnings: [] };
  await assert.rejects(core.writePackage(directory, validBundle(), context, {}, {
    overwrite: true, protectedPaths: [input],
  }), (error) => error.code === "INVALID_ARGUMENT");
  assert.equal(await readFile(input, "utf8"), "keep input");
});
