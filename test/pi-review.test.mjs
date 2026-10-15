import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { validBundle } from "./fixtures/bundle.mjs";
import { normalizePi } from "../dist/adapters/pi/normalize.js";
import { sanitizeBundle } from "../dist/core/privacy.js";
import { compileSmart } from "../dist/context/smart.js";
import { launchPi } from "../dist/adapters/pi/deliver.js";
import { readPiSource } from "../dist/adapters/pi/read.js";
const message = (id, parentId, role, content, extra = {}) => ({
  type: "message",
  id,
  parentId,
  message: { role, content, ...extra },
});
function make(entries) {
  const b = validBundle();
  const header = {
    type: "session",
    version: 3,
    id: "review-pi",
    cwd: "C:/project",
  };
  b.manifest.schemaVersion = 3;
  b.source = {
    harness: "pi",
    runtimeVersion: "1.0.2",
    sessionId: header.id,
    workingDirectory: header.cwd,
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
      id: "header",
      value: header,
      sourceLocator: "pi/session/review-pi/header",
    },
    ...entries.map((e) => ({
      id: "raw-" + e.id,
      value: e,
      sourceLocator: "pi/session/review-pi/entry/" + e.id,
    })),
  ];
  b.history.events = normalizePi(b.history.rawRecords).events;
  b.manifest.counts = {
    events: b.history.events.length,
    rawRecords: b.history.rawRecords.length,
  };
  b.handoff.objective = null;
  b.handoff.latestRequest = null;
  return b;
}
const base = () => [
  message("u1", null, "user", "Please stop the parser loop."),
  message("a1", "u1", "assistant", [{ type: "text", text: "Completed." }], {
    stopReason: "stop",
  }),
];
test("review: confidential Pi calls mask linked results and preserve lifecycle", () => {
  const b = make([
    message("u1", null, "user", "Objective: fix parser"),
    message(
      "a1",
      "u1",
      "assistant",
      [
        {
          type: "toolCall",
          id: "call-1",
          name: "read",
          arguments: { path: ".env" },
        },
      ],
      { stopReason: "toolUse" },
    ),
    message(
      "r1",
      "a1",
      "toolResult",
      [{ type: "text", text: "PRIVATE_FILE_RESULT_MARKER" }],
      { toolCallId: "call-1", toolName: "read" },
    ),
    message("a2", "r1", "assistant", [{ type: "text", text: "Completed." }], {
      stopReason: "stop",
    }),
  ]);
  const safe = sanitizeBundle(b);
  assert.equal(
    JSON.stringify(safe).includes("PRIVATE_FILE_RESULT_MARKER"),
    false,
  );
  assert.equal(
    compileSmart(safe, { maxCharacters: 24000 }).text.includes(
      "PRIVATE_FILE_RESULT_MARKER",
    ),
    false,
  );
  assert.equal(safe.manifest.completeness, "complete");
  assert.deepEqual(sanitizeBundle(safe), safe);
});
test("review: private scalar collisions preserve native structure and verified visible words", () => {
  for (const state of ["stop", "pi", "a1"]) {
    const b = make([
      ...base(),
      {
        type: "custom",
        id: "c1",
        parentId: "a1",
        customType: "opaque",
        data: { state },
      },
    ]);
    const safe = sanitizeBundle(b);
    assert.equal(safe.source.harness, "pi");
    assert.equal(safe.history.events[0].text, "Please stop the parser loop.");
    assert.equal(safe.manifest.completeness, "complete");
    assert.deepEqual(sanitizeBundle(safe), safe);
  }
});
test("review: native system toolsAdded declarations and copied descriptions stay private", () => {
  const entries = base();
  entries.push(
    message("s1", "a1", "system", "", {
      toolsAdded: [
        {
          name: "internal",
          description: "PRIVATE_TOOL_DECLARATION",
          parameters: { type: "object" },
        },
      ],
    }),
  );
  const b = make(entries);
  b.warnings.push({
    code: "SYSTEM_COPY",
    message: "PRIVATE_TOOL_DECLARATION",
    eventIds: [],
  });
  const safe = sanitizeBundle(b);
  assert.equal(
    JSON.stringify(safe).includes("PRIVATE_TOOL_DECLARATION"),
    false,
  );
});
function spec(mode) {
  return {
    executable: process.execPath,
    args: [resolve("test/fixtures/pi-destination.mjs")],
    cwd: process.cwd(),
    stdin: "context",
    timeoutMs: 10000,
    env: { ...process.env, PI_TEST_MODE: mode },
  };
}
test("review: native overflow compaction recovery settles successfully", async () => {
  const r = await launchPi(spec("overflow-recovery"));
  assert.equal(r.status, "launched");
  assert.ok(r.warnings.some((w) => w.code === "PI_AUTOMATIC_RECOVERY"));
  assert.equal((await launchPi(spec("threshold-compaction"))).status, "launched");
});
test("review: new messages and unfinished or failed compaction cannot reuse old completion", async () => {
  for (const mode of ["late-compaction", "late-message", "failed-compaction"])
    assert.equal((await launchPi(spec(mode))).status, "failed", mode);
});
test("review: sole effective checkpoint is required within context budget", () => {
  const b = make([
    ...base(),
    {
      type: "compaction",
      id: "c1",
      parentId: "a1",
      firstKeptEntryId: "c1",
      summary: "SOLE_CHECKPOINT " + "x".repeat(4000),
      tokensBefore: 100,
    },
  ]);
  assert.throws(() => compileSmart(b, { maxCharacters: 1400 }), {
    code: "CONTEXT_BUDGET",
  });
  assert.ok(
    compileSmart(b, { maxCharacters: 24000 }).text.includes("SOLE_CHECKPOINT"),
  );
});
test("review: exact Pi identities ignore suffix overlaps but reject renamed collisions", async () => {
  const root = await mkdtemp(resolve("work/pi-review-"));
  const cwd = join(root, "workspace");
  await mkdir(cwd);
  const home = join(root, "home");
  const encoded = `--${cwd.replace(/^[/\\]/, "").replace(/[/\\:]/g, "-")}--`;
  const dir = join(home, "sessions", encoded);
  await mkdir(dir, { recursive: true });
  const json = (id) =>
    [{ type: "session", version: 3, id, cwd }, ...base()]
      .map(JSON.stringify)
      .join("\n") + "\n";
  await writeFile(join(dir, "one_x.jsonl"), json("x"));
  await writeFile(join(dir, "two_task_x.jsonl"), json("task_x"));
  assert.equal(
    (await readPiSource({ sessionId: "x", cwd, piHome: home })).header.id,
    "x",
  );
  await writeFile(join(dir, "renamed.jsonl"), json("x"));
  await assert.rejects(readPiSource({ sessionId: "x", cwd, piHome: home }), {
    code: "PI_SESSION_NOT_FOUND",
  });
});
