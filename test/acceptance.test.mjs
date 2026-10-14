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
