import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

test("complete fixture handoff preserves safe records, failed-test evidence and remaining work", async (t) => {
  const scratch = resolve("work/acceptance");
  await mkdir(scratch, { recursive: true });
  const root = await mkdtemp(join(scratch, "run-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const workspace = join(root, "project 雪 & literal");
  const codexHome = join(root, "codex-home-normal");
  const bundlePath = join(root, "saved.threadshift.json");
  const output = join(root, "handoff 雪");
  await mkdir(workspace);
  await mkdir(codexHome);
  const git = (args) => execFileSync("git", args, { cwd: workspace, windowsHide: true });
  git(["init", "--quiet"]);
  git(["config", "user.name", "ThreadShift Test"]);
  git(["config", "user.email", "test@example.invalid"]);
  git(["config", "core.autocrlf", "false"]);
  await writeFile(join(workspace, "parser.mjs"), 'export const parse = () => "";\n');
  await writeFile(join(workspace, "parser.test.mjs"), 'import assert from "node:assert/strict"; import {parse} from "./parser.mjs"; assert.equal(parse("雪"), "雪");\n');
  git(["add", "."]);
  git(["commit", "--quiet", "-m", "seed failing parser"]);
  const failed = spawnSync(process.execPath, ["parser.test.mjs"], { cwd: workspace });
  assert.notEqual(failed.status, 0);
  await writeFile(join(workspace, "parser.mjs"), 'export const parse = (value) => value.trim();\n');
  const fields = join(root, "state.json");
  await writeFile(fields, JSON.stringify({
    objective: "Fix Unicode parser handling",
    decisions: ["Keep the parser interface"],
    remaining: ["Add a regression case"],
    verificationState: ["The historical npm test run failed"],
  }));
  const run = (args, env = {}) => {
    const result = spawnSync(process.execPath, [resolve("dist/cli.js"), ...args, "--json"], {
      encoding: "utf8", env: { ...process.env, ...env }, timeout: 30000, windowsHide: true,
    });
    assert.equal(result.status, 0, result.stderr + result.stdout);
    return JSON.parse(result.stdout);
  };
  const sourceArgs = ["--from", "codex", "--session", "00000000-0000-4000-8000-000000000001",
    "--workspace", workspace, "--codex-bin", resolve("test/fixtures/codex-server.mjs"), "--codex-home", codexHome, "--handoff-file", fields];
  run(["export", ...sourceArgs, "--output", bundlePath]);
  const original = await readFile(bundlePath, "utf8");
  const bundle = JSON.parse(original);
  assert.equal(bundle.history.rawRecords.filter((record) => record.value.id === "future-1").length, 1);
  assert.equal(bundle.history.rawRecords.length, bundle.manifest.counts.rawRecords);
  assert.match(original, /1 failing test/);
  assert.doesNotMatch(original, /private reasoning detail/);
  const destinationArgs = ["import", "--bundle", bundlePath, "--to", "opencode",
    "--opencode-bin", resolve("test/fixtures/opencode-server.mjs"), "--output", output];
  run([...destinationArgs, "--dry-run"]);
  await assert.rejects(stat(output), (error) => error.code === "ENOENT");
  const report = run([...destinationArgs, "--launch"], { OPENCODE_TEST_LOG: join(root, "destination.jsonl") });
  assert.equal(report.launch.sessionId, "ses_fixture");
  const context = await readFile(join(output, "continuation.md"), "utf8");
  assert.match(context, /Fix Unicode parser handling/);
  assert.match(context, /Keep the parser interface/);
  assert.match(context, /Add a regression case/);
  assert.match(context, /parser.mjs/);
  assert.match(context, /1 failing test/);
  assert.equal(await readFile(bundlePath, "utf8"), original);
  const requests = (await readFile(join(codexHome, "requests.jsonl"), "utf8")).trim().split("\n").map(JSON.parse);
  assert.ok(requests.every((request) => ["initialize", "initialized", "thread/read", "thread/turns/list"].includes(request.method)));
  const invocation = JSON.parse((await readFile(join(root, "destination.jsonl"), "utf8")).trim());
  assert.equal(invocation.cwd, workspace);
  assert.ok(invocation.argv.includes(join(output, "continuation.md")));
  assert.equal(invocation.argv.includes(join(output, "session.threadshift.json")), false);
});

test("fixture round trip carries attributed first context and distinct OpenCode state to Codex", async t => {
  const root = await mkdtemp(join(resolve("work/acceptance"), "roundtrip-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const workspace = join(root, "project 雪"); await mkdir(workspace);
  execFileSync("git", ["init", "--quiet"], { cwd: workspace });
  const home = join(root, "home"); await mkdir(home);
  await writeFile(join(workspace, "parser.mjs"), 'export const parse = value => value.trim();\n');
  const run = (args) => {
    const result = spawnSync(process.execPath, [resolve("dist/cli.js"), ...args, "--json"], { encoding: "utf8", timeout: 30000, windowsHide: true });
    assert.equal(result.status, 0, result.stdout + result.stderr); return JSON.parse(result.stdout);
  };
  const first = join(root, "first");
  const forward = run(["handoff", "--from", "codex", "--to", "opencode", "--session", "00000000-0000-4000-8000-000000000001", "--workspace", workspace, "--codex-home", home, "--codex-bin", resolve("test/fixtures/codex-server.mjs"), "--opencode-bin", resolve("test/fixtures/opencode-server.mjs"), "--output", first]);
  const firstContext = await readFile(join(first, "continuation.md"), "utf8");
  const firstBundle = JSON.parse(await readFile(join(first, "session.threadshift.json"), "utf8"));
  assert.equal(firstBundle.manifest.schemaVersion, 1);
  assert.match(firstContext, /Fix parser|User request/i);
  // A saved version-1 bundle remains importable to the new destination independently of source.
  run(["import", "--bundle", join(first, "session.threadshift.json"), "--to", "codex", "--codex-bin", resolve("test/fixtures/codex-destination.mjs"), "--output", join(root, "v1-import")]);
  const data = JSON.parse(await readFile(resolve("test/fixtures/opencode-native-contract.json"), "utf8"));
  data.messages[0].text = "Historical first ThreadShift continuation (selected requirement): Fix parser Unicode handling. First bundle: " + firstBundle.manifest.bundleId + "\nCurrent task: preserve Unicode and add the remaining regression.";
  data.messages[1].content.find(x => x.type === "text").text = "OpenCode intermediate decision: retain the parser interface. Trim implemented; remaining work: add the Unicode regression and rerun tests. Earlier failure is historical.";
  const original = JSON.stringify({ data, mode: "normal" });
  await writeFile(join(workspace, "source-fixture.json"), original);
  const output = join(root, "reverse");
  const reverse = run(["handoff", "--from", "opencode", "--to", "codex", "--session", data.info.id, "--workspace", workspace, "--opencode-bin", resolve("test/fixtures/opencode-source.mjs"), "--codex-bin", resolve("test/fixtures/codex-destination.mjs"), "--output", output, "--launch"]);
  assert.equal(reverse.launch.status, "launched");
  const bundle = JSON.parse(await readFile(join(output, "session.threadshift.json"), "utf8"));
  assert.equal(bundle.source.sessionId, data.info.id); assert.notEqual(bundle.source.sessionId, forward.source.sessionId);
  assert.equal(bundle.history.rawRecords.length, 7);
  assert.equal(await readFile(join(workspace, "source-fixture.json"), "utf8"), original);
  const input = JSON.parse(await readFile(join(workspace, "destination-input.json"), "utf8")).stdin;
  assert.match(input, /OpenCode intermediate decision/); assert.match(input, /Unicode regression/);
  assert.match(input, /Fix parser|User request/i); assert.match(input, /historical/i); assert.match(input, /1 test failed/);
  assert.equal(input.includes('"rawRecords"'), false);
  const requests = (await readFile(join(workspace, "requests.jsonl"), "utf8")).trim().split(/\r?\n/).map(JSON.parse);
  assert.ok(requests.every(x => x.method === "GET"));
});

test("native collector forwards reverse direction, keeps pending audits and failure packages", async t => {
  const root = await mkdtemp(join(resolve("work/acceptance"), "collector-")); t.after(() => rm(root, {recursive:true,force:true}));
  const workspace=join(root,"workspace");await mkdir(workspace);execFileSync("git",["init","--quiet"],{cwd:workspace});
  const data=JSON.parse(await readFile(resolve("test/fixtures/opencode-native-contract.json"),"utf8"));
  await writeFile(join(workspace,"source-fixture.json"),JSON.stringify({data,mode:"normal"}));
  const base=[resolve("scripts/native-acceptance.mjs"),"--from","opencode","--to","codex","--session",data.info.id,"--workspace",workspace,"--opencode-bin",resolve("test/fixtures/opencode-source.mjs"),"--codex-bin",resolve("test/fixtures/codex-destination.mjs")];
  const invoke=(extra,env={})=>spawnSync(process.execPath,[...base,...extra],{encoding:"utf8",timeout:30000,windowsHide:true,env:{...process.env,...env}});
  const denied=invoke(["--output",join(root,"denied"),"--launch"]);assert.notEqual(denied.status,0);assert.match(denied.stderr,/provider-kind/);
  const output=join(root,"prepared");const prepared=invoke(["--output",output]);assert.equal(prepared.status,0,prepared.stdout+prepared.stderr);
  const evidence=JSON.parse(await readFile(join(output,"native-evidence.json"),"utf8"));assert.equal(evidence.source.harness,"opencode");assert.equal(evidence.destination.harness,"codex");assert.equal(evidence.launch.status,"not-run");assert.match(evidence.sourceInventoryComparison,/pending/);assert.match(evidence.nativeContinuationAcceptance,/pending/);
  const failedOutput=join(root,"failed");const failed=invoke(["--output",failedOutput,"--launch","--provider-kind","native-local-fixture"],{THREADSHIFT_CODEX_MODE:"failed-turn"});assert.equal(failed.status,1);
  const failedEvidence=JSON.parse(await readFile(join(failedOutput,"native-evidence.json"),"utf8"));assert.equal(failedEvidence.launch.status,"failed");await stat(join(failedOutput,"continuation.md"));
});
