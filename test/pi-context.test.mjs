import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { validBundle } from "./fixtures/bundle.mjs";
import { compileSmart } from "../dist/context/smart.js";
import { sanitizeBundle } from "../dist/core/privacy.js";
let api = {};
try {
  api = {
    ...(await import("../dist/adapters/pi/context.js")),
    ...(await import("../dist/adapters/pi/normalize.js")),
  };
} catch {}
const f = JSON.parse(
  await readFile(
    new URL("./fixtures/pi-session-contract.json", import.meta.url),
    "utf8",
  ),
);
function bundle(extra = []) {
  const b = validBundle(),
    entries = [...structuredClone(f.entries.slice(0, 4)), ...extra];
  b.manifest.schemaVersion = 3;
  b.source = {
    harness: "pi",
    runtimeVersion: "1.0.2",
    sessionId: f.header.id,
    workingDirectory: f.header.cwd,
    captureMechanism: "jsonl-selected-branch",
    selection: {
      kind: "pi-branch",
      leafId: entries.at(-1).id,
      totalEntries: entries.length,
      selectedEntries: entries.length,
      excludedEntries: 0,
    },
  };
  b.history.rawRecords = [
    {
      id: "pi-header",
      sourceLocator: `pi/session/${f.header.id}/header`,
      value: f.header,
    },
    ...entries.map((e) => ({
      id: "pi-" + e.id,
      sourceLocator: `pi/session/${f.header.id}/entry/${e.id}`,
      value: e,
    })),
  ];
  b.history.events = api.normalizePi
    ? api.normalizePi(b.history.rawRecords).events
    : [];
  b.manifest.counts = {
    events: b.history.events.length,
    rawRecords: b.history.rawRecords.length,
  };
  b.handoff.objective = null;
  b.handoff.latestRequest = null;
  return b;
}
test("latest branch edit wins without resurrecting raw originals", () => {
  assert.equal(typeof api.projectPiContext, "function");
  const b = bundle([
    {
      type: "context_edit",
      id: "e1",
      parentId: "a4",
      targetId: "a3",
      replacement: { content: "REPLACEMENT_REQUEST" },
    },
    {
      type: "context_edit",
      id: "e2",
      parentId: "e1",
      targetId: "a3",
      replacement: { content: [{ type: "text", text: "LATEST_REQUEST" }] },
    },
  ]);
  const old = "Current request: handle null.";
  b.handoff.latestRequest = {
    value: old,
    origin: "source-stated",
    eventIds: [b.history.events.find((e) => e.sourceId === "a3").id],
  };
  const before = JSON.stringify(b);
  const text = compileSmart(b, { maxCharacters: 24000 }).text;
  assert.ok(before.includes(old));
  assert.equal(text.includes(old), false);
  assert.ok(text.includes("LATEST_REQUEST"));
  assert.equal(text.includes("REPLACEMENT_REQUEST"), false);
  assert.equal(JSON.stringify(b), before);
});
test("null edits and forged cached handoff cannot revive originals", () => {
  assert.equal(typeof api.projectPiContext, "function");
  const b = bundle([
    {
      type: "context_edit",
      id: "e1",
      parentId: "a4",
      targetId: "a3",
      replacement: null,
    },
  ]);
  b.handoff.latestRequest = {
    value: "Current request: handle null.",
    origin: "inferred",
    eventIds: [],
  };
  assert.equal(
    compileSmart(b, { maxCharacters: 24000 }).text.includes(
      "Current request: handle null.",
    ),
    false,
  );
});
test("compaction keeps verified retained range and retain-none is valid", () => {
  assert.equal(typeof api.projectPiContext, "function");
  for (const anchor of ["a3", "c1"]) {
    const b = bundle([
      {
        type: "compaction",
        id: "c1",
        parentId: "a4",
        firstKeptEntryId: anchor,
        summary: "CHECKPOINT",
        tokensBefore: 100,
      },
    ]);
    const c = compileSmart(b, { maxCharacters: 24000 });
    assert.ok(c.text.includes("CHECKPOINT"));
    assert.equal(c.text.includes("Objective: fix parser"), false);
    assert.equal(
      c.text.includes("Current request: handle null."),
      anchor === "a3",
    );
  }
  assert.throws(
    () =>
      compileSmart(
        bundle([
          {
            type: "compaction",
            id: "c1",
            parentId: "a4",
            firstKeptEntryId: "missing",
            summary: "bad",
          },
        ]),
        { maxCharacters: 24000 },
      ),
    { code: "PI_PROTOCOL" },
  );
});
test("selected Pi canonical inventory rejects siblings and count contradictions", () => {
  assert.equal(typeof api.projectPiContext, "function");
  const b = bundle();
  assert.equal(b.history.rawRecords.length, 5);
  sanitizeBundle(b);
  b.history.rawRecords.push({
    id: "sibling",
    sourceLocator: `pi/session/${f.header.id}/entry/b1`,
    value: f.entries[4],
  });
  b.manifest.counts.rawRecords++;
  assert.throws(() => sanitizeBundle(b), { code: "INVALID_BUNDLE" });
});
export { bundle as piBundle };
test('forged handoff decision copies cannot revive an edited request under unrelated links',()=>{const b=bundle([{type:'context_edit',id:'e1',parentId:'a4',targetId:'a3',replacement:null}]);b.handoff.decisions=[{value:'Current request: handle null.',origin:'source-stated',eventIds:[b.history.events.find(e=>e.sourceId==='a1').id]}];assert.equal(compileSmart(b,{maxCharacters:24000}).text.includes('Current request: handle null.'),false);});
