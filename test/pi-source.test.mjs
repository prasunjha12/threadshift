import test from "node:test";
import assert from "node:assert/strict";
import { readFile, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
let api = {};
try {
  api = {
    ...(await import("../dist/adapters/pi/format.js")),
    ...(await import("../dist/adapters/pi/read.js")),
  };
} catch {}
const fixture = JSON.parse(
  await readFile(
    new URL("./fixtures/pi-session-contract.json", import.meta.url),
    "utf8",
  ),
);
const text = (d) =>
  [d.header, ...d.entries].map(JSON.stringify).join("\n") + "\n";
test("only selected Pi ancestry is returned and branched Pi requires explicit selection", () => {
  assert.equal(typeof api.selectPiBranch, "function");
  assert.throws(() => api.selectPiBranch(fixture, {}), {
    code: "PI_BRANCH_REQUIRED",
  });
  const r = api.selectPiBranch(api.parsePiJsonl(text(fixture)), {
    leafId: "a4",
  });
  assert.deepEqual(r.selection, fixture.selection);
  assert.equal(JSON.stringify(r).includes("SIBLING_EXCLUDED_MARKER"), false);
  assert.equal(r.completeness, "complete");
});
test("Pi structural corruption and partial tails are rejected without payloads", () => {
  assert.equal(typeof api.parsePiJsonl, "function");
  for (const change of [
    (d) => (d.header.version = 2),
    (d) => (d.entries[0].parentId = "a4"),
    (d) => (d.entries[1].id = "a1"),
    (d) => (d.entries[0].parentId = "missing"),
  ]) {
    const d = structuredClone(fixture);
    change(d);
    assert.throws(() => api.parsePiJsonl(text(d)), { code: "PI_PROTOCOL" });
  }
  assert.throws(() => api.parsePiJsonl(text(fixture) + "{"), {
    code: "PI_PROTOCOL",
  });
  const d = structuredClone(fixture);
  d.entries[0].message.content = "Unicode 雪\u2028line\u2029";
  assert.equal(
    api.parsePiJsonl(text(d)).entries[0].message.content,
    d.entries[0].message.content,
  );
});
test("Pi selected boundary blocks pending tools and requests; metadata tail stays complete", () => {
  assert.equal(typeof api.selectPiBranch, "function");
  const d = { header: fixture.header, entries: fixture.entries.slice(0, 4) };
  d.entries.push({ type: "label", id: "l1", parentId: "a4", label: "name" });
  assert.equal(api.selectPiBranch(d, {}).completeness, "complete");
  d.entries.push({
    type: "message",
    id: "u5",
    parentId: "l1",
    message: { role: "user", content: "pending" },
  });
  assert.throws(() => api.selectPiBranch(d, {}), { code: "SOURCE_ACTIVE" });
});
test("stable Pi reader detects replacement and cancellation", async () => {
  assert.equal(typeof api.readStablePiText, "function");
  let i = 0;
  await assert.rejects(
    api.readStablePiText(async () => ({ text: "same", identity: String(i++) })),
    { code: "SOURCE_CHANGED" },
  );
  await assert.rejects(
    api.readStablePiText(
      async () => ({ text: "same", identity: "same" }),
      AbortSignal.abort(),
    ),
    { code: "PROCESS_CANCELLED" },
  );
});
test("Pi reads exact files read-only and rejects identity/workspace mismatch", async () => {
  assert.equal(typeof api.readPiSource, "function");
  const root = await mkdtemp(join(process.cwd(), "work/pi-source-"));
  const cwd = join(root, "workspace");
  await mkdir(cwd);
  const d = {
    header: { ...fixture.header, cwd, id: "CON" },
    entries: fixture.entries.slice(0, 4),
  };
  const file = join(root, "selected.jsonl");
  await writeFile(file, text(d));
  const opts = {
    sessionId: file,
    cwd,
    executable: process.execPath,
    version: "1.0.2",
  };
  const r = await api.readPiSource(opts);
  assert.equal(r.header.id, "CON");
  assert.equal(await readFile(file, "utf8"), text(d));
  await assert.rejects(api.readPiSource({ ...opts, cwd: root }), {
    code: "WORKSPACE_MISMATCH",
  });
  await assert.rejects(api.readPiSource({ ...opts, maxCaptureBytes: 10 }), {
    code: "CAPTURE_TOO_LARGE",
  });
});
test("Pi exact ID lookup rejects ambiguity, invalid selectors and missing sources", async () => {
  const root = await mkdtemp(join(process.cwd(), "work/pi-id-"));
  const cwd = join(root, "workspace");
  await mkdir(cwd);
  const encoded = `--${cwd.replace(/^[/\\]/, "").replace(/[/\\:]/g, "-")}--`;
  const dir = join(root, "home", "sessions", encoded);
  await mkdir(dir, { recursive: true });
  const d = {
    header: { ...fixture.header, cwd, id: "task_01-a" },
    entries: fixture.entries.slice(0, 4),
  };
  const original = text(d);
  await writeFile(join(dir, "one_task_01-a.jsonl"), original);
  const opts = { sessionId: "task_01-a", cwd, piHome: join(root, "home") };
  assert.equal((await api.readPiSource(opts)).header.id, "task_01-a");
  await writeFile(join(dir, "two_task_01-a.jsonl"), original);
  await assert.rejects(api.readPiSource(opts), {
    code: "PI_SESSION_NOT_FOUND",
  });
  await assert.rejects(api.readPiSource({ ...opts, sessionId: "../escape" }), {
    code: "INVALID_ARGUMENT",
  });
  await assert.rejects(api.readPiSource({ ...opts, sessionId: "missing" }), {
    code: "PI_SESSION_NOT_FOUND",
  });
});
test('inherited Pi ancestry remains incomplete without independent coverage',()=>{const d={header:{...fixture.header,parentSession:'/unread/parent.jsonl'},entries:fixture.entries.slice(0,4)};const r=api.selectPiBranch(d,{});assert.equal(r.completeness,'incomplete');assert.ok(r.warnings.some(w=>w.code==='PI_INHERITED_HISTORY_UNVERIFIED'));});
