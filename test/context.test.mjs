import test from "node:test";
import assert from "node:assert/strict";
import { validBundle } from "./fixtures/bundle.mjs";

let handoff;
let smart;
try {
  handoff = await import("../dist/context/handoff.js");
  smart = await import("../dist/context/smart.js");
} catch {
  handoff = {};
  smart = {};
}

function bundleWithEvents(events) {
  const bundle = validBundle();
  bundle.history.events = events;
  bundle.manifest.counts.events = events.length;
  bundle.handoff = {
    objective: null,
    latestRequest: null,
    currentState: null,
    completed: [], decisions: [], remaining: [], blockers: [], nextActions: [], importantFiles: [], verificationState: [], activePlan: [],
  };
  return bundle;
}

test("latest request is included verbatim and reserved before optional history", () => {
  const request = "Please continue. Keep the Unicode path 雪.txt and do not drop this sentence.";
  const bundle = bundleWithEvents([
    { id: "user-latest", order: 0, kind: "user", text: request, rawRecordIds: ["raw-1"] },
    { id: "old", order: 1, kind: "assistant", text: "old context ".repeat(100), rawRecordIds: ["raw-1"] },
  ]);
  const context = smart.compileSmart(bundle, { maxCharacters: 1100 });
  assert.ok(context.text.includes(request));
  assert.equal(context.selectedEventIds.includes("user-latest"), true);
  assert.equal(context.omittedEventIds.includes("old"), true);
  assert.equal(context.characterCount, [...context.text].length);
});

test("missing objective stays unknown unless the user stated it explicitly", () => {
  const capture = {
    events: [{ id: "assistant", order: 0, kind: "assistant", text: "The objective is probably migrate everything.", rawRecordIds: [] }],
  };
  const workspace = { root: "C:/project", inspectedAt: "2026-10-13T00:00:00Z", digest: "sha256:workspace", changedFiles: [], instructionReferences: [], artifactReferences: [], git: { present: false, head: null, branch: null, status: [], patches: [], warnings: [] }, warnings: [] };
  assert.equal(typeof handoff.deriveHandoff, "function");
  const state = handoff.deriveHandoff(capture, workspace);
  assert.equal(state.objective, null);
  const bundle = bundleWithEvents(capture.events);
  const context = smart.compileSmart(bundle, { maxCharacters: 1200 });
  assert.match(context.text, /Unknown: objective/);
  const explicit = handoff.deriveHandoff({ events: [{ id: "user", order: 0, kind: "user", text: "Objective: migrate parser only", rawRecordIds: [] }] }, workspace);
  assert.deepEqual(explicit.objective, { value: "migrate parser only", origin: "source-stated", eventIds: ["user"] });
});

test("user handoff fields are attributed and cannot replace source history", () => {
  const capture = { events: [{ id: "latest", order: 0, kind: "user", text: "Fix parser", rawRecordIds: [] }] };
  const workspace = { root: "C:/project", inspectedAt: "2026-10-13T00:00:00Z", digest: "sha256:workspace", changedFiles: [], instructionReferences: [], artifactReferences: [], git: { present: false, head: null, branch: null, status: [], patches: [], warnings: [] }, warnings: [] };
  const state = handoff.deriveHandoff(capture, workspace, { objective: "Parser cleanup", decisions: ["Keep API stable"] });
  assert.equal(state.objective.origin, "user-supplied");
  assert.deepEqual(state.objective.eventIds, []);
  assert.equal(state.latestRequest.value, "Fix parser");
  assert.throws(() => handoff.deriveHandoff(capture, workspace, { sessionId: "forged" }), (error) => error.code === "INVALID_HANDOFF_FIELDS");
});

test("historical verification is never presented as a current passing result", () => {
  const bundle = bundleWithEvents([
    { id: "user", order: 0, kind: "user", text: "Fix parser", rawRecordIds: ["raw-1"] },
    { id: "test-result", order: 1, kind: "tool-result", callId: "test-call", text: "npm test: all 4 tests passed", rawRecordIds: ["raw-1"] },
  ]);
  bundle.history.events.push({ id: "test-call", order: 2, kind: "tool-call", callId: "test-call", text: "Command: npm test", rawRecordIds: ["raw-1"] });
  bundle.manifest.counts.events = bundle.history.events.length;
  bundle.handoff.latestRequest = { value: "Fix parser", origin: "source-stated", eventIds: ["user"] };
  const context = smart.compileSmart(bundle, { maxCharacters: 900 });
  assert.match(context.text, /historical|not current/i);
  assert.doesNotMatch(context.text, /Currently passing/);
});

test("linked historical tool calls and results are selected together within a Unicode character budget", () => {
  const bundle = bundleWithEvents([
    { id: "user", order: 0, kind: "user", text: "Fix parser 雪", rawRecordIds: ["raw-1"] },
    { id: "call", order: 1, kind: "tool-call", callId: "pair", text: "Command: npm test", rawRecordIds: ["raw-1"] },
    { id: "result", order: 2, kind: "tool-result", callId: "pair", text: "Status: failed", rawRecordIds: ["raw-1"] },
  ]);
  bundle.handoff.latestRequest = { value: "Fix parser 雪", origin: "source-stated", eventIds: ["user"] };
  const context = smart.compileSmart(bundle, { maxCharacters: 1100 });
  assert.equal(context.selectedEventIds.includes("call"), context.selectedEventIds.includes("result"));
  assert.ok(context.text.indexOf("[call]") < context.text.indexOf("[result]"));
  assert.ok(context.characterCount <= 1100);
  assert.equal(context.characterCount, [...context.text].length);
});

test("compiler fails when required identity and latest request exceed the budget", () => {
  const bundle = bundleWithEvents([{ id: "latest", order: 0, kind: "user", text: "雪".repeat(300), rawRecordIds: ["raw-1"] }]);
  bundle.handoff.latestRequest = { value: "雪".repeat(300), origin: "source-stated", eventIds: ["latest"] };
  assert.throws(() => smart.compileSmart(bundle, { maxCharacters: 100 }), (error) => error.code === "CONTEXT_BUDGET");
});

test("context compilation leaves the canonical bundle unchanged", () => {
  const bundle = bundleWithEvents([{ id: "latest", order: 0, kind: "user", text: "Fix parser", rawRecordIds: ["raw-1"] }]);
  bundle.handoff.latestRequest = { value: "Fix parser", origin: "source-stated", eventIds: ["latest"] };
  const before = JSON.stringify(bundle);
  smart.compileSmart(bundle, { maxCharacters: 700 });
  assert.equal(JSON.stringify(bundle), before);
});
