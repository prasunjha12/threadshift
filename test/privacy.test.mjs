import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { assertDefaultOutputContained, redactRecord, sanitizeBundle, validateBundle, writeBundle, writePackage } from "../dist/core/index.js";
import { loadBundle } from "../dist/pipeline.js";
import { inspectWorkspace } from "../dist/workspace/inspect.js";
import { createOpenCodeLaunchSpec } from "../dist/adapters/opencode/deliver.js";
import { validBundle } from "./fixtures/bundle.mjs";

const scratch = resolve("work/privacy-tests");

test("OpenCode-shaped reasoning text and state cannot leak through linked copies", () => {
  const bundle = validBundle();
  const dummy = "SYNTHETIC_REASONING_COPY_ONLY";
  bundle.history.rawRecords[0].value = { type: "reasoning", text: dummy, state: { cachedSummary: dummy }, time: { created: 1000, hidden: dummy } };
  bundle.history.events[0].text = dummy;
  bundle.handoff.latestRequest.value = dummy;
  bundle.provenance = [{ value: dummy, origin: "source-stated", eventIds: ["event-1"] }];
  bundle.warnings = [{ code: "TEST_COPY", message: dummy, eventIds: ["event-1"] }];
  const safe = sanitizeBundle(bundle);
  assert.equal(JSON.stringify(safe).includes(dummy), false);
  assert.ok(safe.manifest.exclusions.includes("reasoning.text"));
  assert.deepEqual(sanitizeBundle(safe), safe);
});

test("OpenCode provider-private state is excluded while safe unknown raw metadata survives", () => {
  const bundle = validBundle();
  bundle.manifest.schemaVersion = 2;
  bundle.source.harness = "opencode";
  const dummy = "SYNTHETIC_OPAQUE_PROVIDER_ONLY";
  bundle.history.rawRecords[0].value = { type: "assistant", providerState: { payload: dummy }, futureSafeMetadata: { count: 4 } };
  bundle.history.events[0].text = dummy;
  bundle.handoff.latestRequest.value = dummy;
  const safe = sanitizeBundle(bundle);
  assert.equal(JSON.stringify(safe).includes(dummy), false);
  assert.deepEqual(safe.history.rawRecords[0].value.futureSafeMetadata, { count: 4 });
  assert.ok(safe.manifest.exclusions.includes("provider-state"));
});
await mkdir(scratch, { recursive: true });
async function temporary(t) {
  const root = await mkdtemp(join(scratch, "case-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

test("credential assignments in text are masked across shell JSON prose and URLs", () => {
  const dummy = "SYNTHETIC_ONLY_0123456789";
  for (const text of [`API_KEY=${dummy}`, `password: '${dummy}'`, `--api-key \"${dummy}\"`, `\"client_secret\": \"${dummy}\"`, `https://example.invalid/?access_token=${dummy}`, `export AWS_SECRET_ACCESS_KEY=${dummy}`, `API key: ${dummy}`, `Authorization: Bearer ${dummy}`, `Authorization: Basic ${dummy}`, `DATABASE_URL=postgresql://user:${dummy}@example.invalid/db`]) {
    const result = redactRecord(text);
    assert.equal(JSON.stringify(result.value).includes(dummy), false, text);
    assert.equal(result.warnings.length, 1);
  }
  assert.equal(redactRecord("The parser returns zero for an empty list.").value, "The parser returns zero for an empty list.");
  for (const text of ["Authorization: Bearer abc123", "Authorization: Basic abc123", "API_KEY=[REDACTED:attacker prefix]SYNTHETIC_CREDENTIAL", "API_KEY=[REDACTED:credential assignment]SYNTHETIC_CREDENTIAL"]) {
    assert.equal(JSON.stringify(redactRecord(text).value).includes(text.includes("abc123") ? "abc123" : "SYNTHETIC_CREDENTIAL"), false);
  }
  assert.deepEqual(redactRecord({ totalTokens: 1500, tokenUsage: { input: 100 }, tokenizer: "cl100k_base" }).value, { totalTokens: 1500, tokenUsage: { input: 100 }, tokenizer: "cl100k_base" });
});

test("unsafe imported bundle IDs are rejected before output selection", () => {
  for (const id of ["../../Pictures", "..\\..\\Pictures", "/tmp/private", "C:\\private", "%2e%2e/secret", "CON", "trailing."]) {
    const bundle = validBundle();
    bundle.manifest.bundleId = id;
    assert.throws(() => validateBundle(bundle), (error) => error.code === "INVALID_BUNDLE");
  }
  assert.equal(validateBundle(validBundle()).manifest.bundleId, "bundle-1");
});

test("import removes credential fields and extra bundle data without modifying the source", async (t) => {
  const root = await temporary(t);
  const bundle = validBundle();
  bundle.manifest.bundleId = "00000000-0000-4000-8000-000000000002";
  const dummy = "sk-proj-SYNTHETIC_DUMMY_0123456789";
  bundle.history.rawRecords[0].value.apiKey = dummy;
  bundle.history.events[0].text = `API_KEY=${dummy}`;
  bundle.handoff.latestRequest.value = `API_KEY=${dummy}`;
  bundle.git.patches = [{ path: "ordinary.txt", staged: false, text: `password=${dummy}` }];
  bundle.extraPrivatePayload = "SYNTHETIC_PRIVATE_PAYLOAD";
  const path = join(root, "input.json");
  const original = JSON.stringify(bundle);
  await writeFile(path, original);
  const imported = await loadBundle(path);
  assert.equal(JSON.stringify(imported).includes(dummy), false);
  assert.equal("extraPrivatePayload" in imported, false);
  assert.equal(await readFile(path, "utf8"), original);
});

test("bundle persistence sanitizes direct callers too", async (t) => {
  const root = await temporary(t);
  const bundle = validBundle();
  bundle.manifest.bundleId = "00000000-0000-4000-8000-000000000002";
  bundle.history.events[0].text = "API_KEY=SYNTHETIC_ONLY_0123456789";
  await writeBundle(join(root, "out.json"), bundle, { overwrite: false });
  assert.equal((await readFile(join(root, "out.json"), "utf8")).includes("SYNTHETIC_ONLY_0123456789"), false);
});

test("tracked secret files and project exclusions never contribute patch contents or file hashes", async (t) => {
  const root = await temporary(t);
  const git = (...args) => execFileSync("git", args, { cwd: root, stdio: "pipe", windowsHide: true });
  git("init", "--quiet");
  git("config", "user.name", "ThreadShift Test");
  git("config", "user.email", "test@example.invalid");
  await mkdir(join(root, "client-data"));
  for (const file of [".env", "client-data/note.txt", "ordinary.txt"]) await writeFile(join(root, file), "before\n");
  await writeFile(join(root, ".threadshiftignore"), "client-data/\n");
  git("add", ".");
  git("commit", "--quiet", "-m", "synthetic baseline");
  await writeFile(join(root, ".env"), "SYNTHETIC_PRIVATE_ENV_CONTENT\n");
  await writeFile(join(root, "client-data/note.txt"), "SYNTHETIC_PRIVATE_CLIENT_CONTENT\n");
  await writeFile(join(root, "ordinary.txt"), "legitimate change\n");
  const workspace = await inspectWorkspace(root);
  assert.equal(JSON.stringify(workspace).includes("SYNTHETIC_PRIVATE"), false);
  assert.equal(workspace.git.patches.some((item) => item.path === ".env" || item.path.startsWith("client-data/")), false);
  assert.equal(workspace.changedFiles.some((item) => (item.path === ".env" || item.path.startsWith("client-data/")) && item.digest), false);
  assert.equal(workspace.git.patches.some((item) => item.path === "ordinary.txt" && item.text.includes("legitimate change")), true);
});

test("default launch attaches only selected context and full history requires explicit opt in", () => {
  const harness = { executable: "opencode", argsPrefix: [] };
  const root = process.cwd();
  const context = join(root, "continuation.md");
  const bundle = join(root, "session.threadshift.json");
  const normal = createOpenCodeLaunchSpec(harness, root, context, bundle);
  assert.equal(normal.args.filter((arg) => arg === "--file").length, 1);
  assert.equal(normal.args.includes(bundle), false);
  const explicit = createOpenCodeLaunchSpec(harness, root, context, bundle, { attachBundle: true });
  assert.equal(explicit.args.includes(bundle), true);
});

test("sanitizer strips wrapper extras and imported reasoning while preserving safe unknown raw metadata", () => {
  const bundle = validBundle();
  bundle.manifest.counts.extra = "SYNTHETIC_PRIVATE_EXTRA";
  bundle.history.events[0].extra = "SYNTHETIC_PRIVATE_EXTRA";
  bundle.handoff.latestRequest.extra = "SYNTHETIC_PRIVATE_EXTRA";
  bundle.history.rawRecords[0].value = { type: "reasoning", content: "SYNTHETIC_PRIVATE_REASONING", summary: "SYNTHETIC_PRIVATE_REASONING", futureSafeField: "preserve this" };
  const sanitized = sanitizeBundle(bundle);
  assert.equal(JSON.stringify(sanitized).includes("SYNTHETIC_PRIVATE"), false);
  assert.equal(sanitized.history.rawRecords[0].value.futureSafeField, "preserve this");
  assert.equal(sanitized.manifest.exclusions.includes("reasoning.content"), true);
  assert.deepEqual(sanitizeBundle(sanitized), sanitized);
  bundle.history.rawRecords[0].value = { future: { items: [{ type: "reasoning", content: "SYNTHETIC_PRIVATE_REASONING", summary: "SYNTHETIC_PRIVATE_REASONING" }] } };
  bundle.history.events[0].text = "SYNTHETIC_PRIVATE_REASONING";
  bundle.handoff.latestRequest.value = "SYNTHETIC_PRIVATE_REASONING";
  assert.equal(JSON.stringify(sanitizeBundle(bundle)).includes("SYNTHETIC_PRIVATE_REASONING"), false);
});

test("confidential history copies are excluded with their linked handoff and provenance", () => {
  const bundle = validBundle();
  bundle.history.rawRecords[0].value = { type: "commandExecution", command: "cat .env", aggregatedOutput: "SYNTHETIC_PRIVATE_FILE_BODY" };
  bundle.history.events[0].text = "SYNTHETIC_PRIVATE_FILE_BODY";
  bundle.handoff.latestRequest.value = "SYNTHETIC_PRIVATE_FILE_BODY";
  bundle.provenance = [{ value: "SYNTHETIC_PRIVATE_FILE_BODY", origin: "observed", eventIds: ["event-1"] }];
  bundle.warnings = [{ code: "TOOL_OUTPUT", message: "SYNTHETIC_PRIVATE_FILE_BODY", eventIds: ["event-1"] }];
  const sanitized = sanitizeBundle(bundle);
  assert.equal(JSON.stringify(sanitized).includes("SYNTHETIC_PRIVATE_FILE_BODY"), false);
  assert.equal(sanitized.history.events[0].id, "event-1");
  assert.deepEqual(sanitized.history.events[0].rawRecordIds, ["raw-1"]);
});

test("lower package writer regenerates context from sanitized history even without path hints", async (t) => {
  const root = await temporary(t);
  const bundle = validBundle();
  bundle.history.rawRecords[0].value = { type: "commandExecution", command: "cat .env", aggregatedOutput: "SYNTHETIC_PRIVATE_FILE_BODY" };
  const context = { text: "SYNTHETIC_PRIVATE_FILE_BODY", characterCount: 27, selectedEventIds: [], omittedEventIds: [], warnings: [] };
  await writePackage(join(root, "package"), bundle, context, {}, { overwrite: false });
  assert.equal((await readFile(join(root, "package", "continuation.md"), "utf8")).includes("SYNTHETIC_PRIVATE_FILE_BODY"), false);
});

test("repeated credential sanitization is stable and does not grow warnings", () => {
  const bundle = validBundle();
  bundle.history.rawRecords[0].value.apiKey = "SYNTHETIC_CREDENTIAL";
  bundle.history.events[0].text = "API_KEY=SYNTHETIC_CREDENTIAL";
  const once = sanitizeBundle(bundle);
  assert.deepEqual(sanitizeBundle(once), once);
});

test("schema scalar fields cannot carry hidden objects", () => {
  const bundle = validBundle();
  bundle.history.events[0].timestamp = { hidden: "SYNTHETIC_PRIVATE_BODY" };
  assert.throws(() => sanitizeBundle(bundle), (error) => error.code === "INVALID_BUNDLE");
});

test("ordinary patches mentioning excluded filenames retain their snapshot digest", () => {
  const bundle = validBundle();
  bundle.git.patches = [{ path: "README.md", staged: false, text: "diff --git a/README.md b/README.md\n@@ -1 +1 @@\n+Set up .env for development" }];
  const safe = sanitizeBundle(bundle);
  assert.equal(safe.git.patches.length, 1);
});

test("default output rejects escaping paths and keeps legitimate child outputs", async (t) => {
  const root = await temporary(t);
  const base = join(root, "handoffs");
  await assertDefaultOutputContained(base, join(base, "bundle-1"));
  await assert.rejects(assertDefaultOutputContained(base, join(root, "unrelated")), (error) => error.code === "INVALID_ARGUMENT");
});

test("privacy policy follows imported renamed files and names containing spaces", () => {
  const bundle = validBundle();
  bundle.history.rawRecords[0].value = { command: 'type "client notes.txt"', aggregatedOutput: "SYNTHETIC_PRIVATE_BODY" };
  bundle.git.status = [{ path: "visible.txt", originalPath: ".env", xy: "R " }];
  bundle.git.patches = [{ path: "visible.txt", staged: true, text: "SYNTHETIC_PRIVATE_BODY" }];
  bundle.workspace.changedFiles = [{ path: "visible.txt", status: "R ", staged: true, unstaged: false, digest: "sha256:private" }];
  const safe = sanitizeBundle(bundle, ["client notes.txt"]);
  assert.equal(JSON.stringify(safe).includes("SYNTHETIC_PRIVATE_BODY"), false);
  assert.equal(safe.git.patches.length, 0);
  assert.equal(safe.workspace.changedFiles[0].digest, undefined);
});

test("native Git rename from a secret filename is excluded before hashing and diff capture", async (t) => {
  const root = await temporary(t);
  const git = (...args) => execFileSync("git", args, { cwd: root, stdio: "pipe", windowsHide: true });
  git("init", "--quiet");
  git("config", "user.name", "ThreadShift Test");
  git("config", "user.email", "test@example.invalid");
  await writeFile(join(root, ".env"), "SYNTHETIC_PRIVATE_BODY\n");
  git("add", ".env");
  git("commit", "--quiet", "-m", "synthetic secret filename");
  git("mv", ".env", "visible.txt");
  const state = await inspectWorkspace(root);
  assert.equal(state.git.patches.length, 0);
  assert.equal(state.changedFiles.some((entry) => entry.digest), false);
  assert.equal(JSON.stringify(state).includes("SYNTHETIC_PRIVATE_BODY"), false);
});

test("recognized OpenCode text state is private across linked copies and outbound preparation", async t => {
  const root=await temporary(t);const bundle=validBundle();bundle.manifest.schemaVersion=2;bundle.source.harness="opencode";bundle.workspace.root=root;
  const marker="SYNTHETIC_TEXT_PROVIDER_PRIVATE";
  bundle.history.rawRecords[0].value={type:"text",text:"Visible answer",state:{payload:marker},futureSafeField:4};
  bundle.history.events[0].text=marker;bundle.handoff.latestRequest.value=marker;
  bundle.provenance=[{value:marker,origin:"source-stated",eventIds:["event-1"]}];bundle.warnings=[{code:"LINKED",message:marker,eventIds:["event-1"]}];
  const safe=sanitizeBundle(bundle);assert.equal(JSON.stringify(safe).includes(marker),false);assert.equal(safe.history.rawRecords[0].value.text,"Visible answer");assert.equal(safe.history.rawRecords[0].value.futureSafeField,4);assert.ok(safe.manifest.exclusions.includes("provider-state"));assert.deepEqual(sanitizeBundle(safe),safe);
  const {prepareCodex}=await import("../dist/adapters/codex/deliver.js");const {compileSmart}=await import("../dist/context/smart.js");const {createReport}=await import("../dist/pipeline.js");
  const context=compileSmart(bundle,{maxCharacters:24000});const prepared=await prepareCodex(join(root,"output"),bundle,context,createReport(bundle,context,"0.162.1",{preparation:"prepared",destination:"codex"}),{executable:process.execPath,argsPrefix:[]},{overwrite:false,attachBundle:true});assert.equal(prepared.launch.stdin.includes(marker),false);
});

test("imported inline media is excluded canonically with linked copies before full attachment", async t => {
  const root=await temporary(t);const bundle=validBundle();bundle.manifest.schemaVersion=2;bundle.source.harness="opencode";bundle.workspace.root=root;
  const marker="SYNTHETIC_IMPORTED_MEDIA_PRIVATE";
  bundle.history.rawRecords[0].value={type:"user",files:[{data:marker,mime:"image/png",source:{type:"uri",uri:"https://example.invalid/image.png"}}],futureSafeField:4};
  bundle.history.events[0].text=marker;bundle.handoff.latestRequest.value=marker;bundle.provenance=[{value:marker,origin:"source-stated",eventIds:["event-1"]}];bundle.warnings=[{code:"LINKED",message:marker,eventIds:["event-1"]}];
  const path=join(root,"import.json");await writeFile(path,JSON.stringify(bundle));const original=await readFile(path,"utf8");const safe=await loadBundle(path);
  assert.equal(JSON.stringify(safe).includes(marker),false);assert.ok(safe.manifest.exclusions.includes("media.content"));assert.equal(safe.history.rawRecords[0].value.futureSafeField,4);assert.match(safe.history.rawRecords[0].value.files[0].source.uri,/example.invalid/);assert.deepEqual(sanitizeBundle(safe),safe);assert.equal(await readFile(path,"utf8"),original);
  await writeBundle(join(root,"safe.json"),bundle,{overwrite:false});assert.equal((await readFile(join(root,"safe.json"),"utf8")).includes(marker),false);
  const {prepareCodex}=await import("../dist/adapters/codex/deliver.js");const {compileSmart}=await import("../dist/context/smart.js");const {createReport}=await import("../dist/pipeline.js");const context=compileSmart(bundle,{maxCharacters:24000});
  const prepared=await prepareCodex(join(root,"output"),bundle,context,createReport(bundle,context,"0.162.1",{preparation:"prepared",destination:"codex"}),{executable:process.execPath,argsPrefix:[]},{overwrite:false,attachBundle:true});assert.equal(prepared.launch.stdin.includes(marker),false);
});

test("safe visible OpenCode text survives provider-state exclusion in normalized context", () => {
  const bundle=validBundle();bundle.manifest.schemaVersion=2;bundle.source.harness="opencode";
  bundle.history.rawRecords[0].value={type:"text",text:"Visible answer",state:{payload:"SYNTHETIC_PROVIDER_ONLY"}};
  bundle.history.events[0].text="Visible answer";
  const safe=sanitizeBundle(bundle);assert.equal(safe.history.events[0].text,"Visible answer");assert.equal(JSON.stringify(safe).includes("SYNTHETIC_PROVIDER_ONLY"),false);
});
