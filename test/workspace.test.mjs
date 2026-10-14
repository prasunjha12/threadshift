import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, unlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

let inspectWorkspace;
let compareWorkspace;
try {
  ({ inspectWorkspace } = await import("../dist/workspace/inspect.js"));
  ({ compareWorkspace } = await import("../dist/workspace/compare.js"));
} catch {
  inspectWorkspace = undefined;
  compareWorkspace = undefined;
}
const scratch = join(process.cwd(), "work", "workspace-tests");
await mkdir(scratch, { recursive: true });

async function fixture() {
  const root = await mkdtemp(join(scratch, "repo-"));
  const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  git("init", "--quiet");
  git("config", "user.name", "ThreadShift Test");
  git("config", "user.email", "test@example.invalid");
  await writeFile(join(root, "old name 雪.txt"), `${Array.from({ length: 20 }, (_, index) => `shared line ${index}`).join("\n")}\n`);
  git("add", "--", "old name 雪.txt");
  git("commit", "--quiet", "-m", "initial");
  return { root, git };
}

test("workspace capture handles Unicode renames, staged and unstaged changes, deletions and untracked files", async (t) => {
  assert.equal(typeof inspectWorkspace, "function");
  const { root, git } = await fixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  git("mv", "--", "old name 雪.txt", "renamed name 雪.txt");
  await writeFile(join(root, "renamed name 雪.txt"), `${Array.from({ length: 20 }, (_, index) => `shared line ${index}`).join("\n")}\nstaged line\n`);
  git("add", "--", "renamed name 雪.txt");
  await writeFile(join(root, "renamed name 雪.txt"), `${Array.from({ length: 20 }, (_, index) => `shared line ${index}`).join("\n")}\nstaged and unstaged line\n`);
  await writeFile(join(root, "untracked 雪.txt"), "not staged\n");
  await writeFile(join(root, "delete me.txt"), "remove\n");
  git("add", "--", "delete me.txt");
  await unlink(join(root, "delete me.txt"));

  const snapshot = await inspectWorkspace(root);
  assert.equal(snapshot.git.present, true);
  assert.equal(snapshot.changedFiles.some((file) => file.path.includes("renamed name 雪.txt") && file.staged && file.unstaged), true);
  assert.equal(snapshot.changedFiles.some((file) => file.path === "old name 雪.txt" && file.status === "renamed-from"), true);
  assert.equal(snapshot.changedFiles.some((file) => file.path.includes("untracked 雪.txt") && file.digest), true);
  assert.equal(snapshot.changedFiles.some((file) => file.path.includes("delete me.txt")), true);
  assert.equal(snapshot.git.patches.some((patch) => patch.path.includes("renamed name 雪.txt") && patch.staged), true);
});

test("workspace capture supports detached HEAD and an unborn repository", async (t) => {
  assert.equal(typeof inspectWorkspace, "function");
  const { root, git } = await fixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  git("checkout", "--quiet", "--detach");
  const detached = await inspectWorkspace(root);
  assert.equal(detached.git.head?.length, 40);
  assert.equal(detached.git.branch, null);
  const empty = await mkdtemp(join(scratch, "unborn-"));
  t.after(() => rm(empty, { recursive: true, force: true }));
  execFileSync("git", ["init", "--quiet"], { cwd: empty });
  const unborn = await inspectWorkspace(empty);
  assert.equal(unborn.git.present, true);
  assert.equal(unborn.git.head, null);
});

test("subdirectory workspaces retain repository-relative hashes and patches", async (t) => {
  const { root } = await fixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  const sub = join(root, "sub");
  await mkdir(sub);
  await writeFile(join(sub, "new.txt"), "before");
  await writeFile(join(root, "old name 雪.txt"), "changed tracked text");
  const before = await inspectWorkspace(sub);
  assert.ok(before.changedFiles.find((file) => file.path === "sub/new.txt")?.digest);
  assert.ok(before.git.patches.find((patch) => patch.path === "old name 雪.txt")?.text);
  await writeFile(join(sub, "new.txt"), "after");
  const after = await inspectWorkspace(sub);
  assert.notEqual(after.digest, before.digest);
  assert.equal(before.root, sub);
});

test("workspace capture represents a non-Git directory explicitly", async (t) => {
  assert.equal(typeof inspectWorkspace, "function");
  const root = await mkdtemp(join(resolve(process.cwd(), "..", "..", ".."), "threadshift-plain-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, "file.txt"), "current local work\n");
  const snapshot = await inspectWorkspace(root);
  assert.equal(snapshot.git.present, false);
  assert.equal(snapshot.git.head, null);
  assert.deepEqual(snapshot.git.patches, []);
});

test("workspace capture records binary changes without exporting their bytes", async (t) => {
  assert.equal(typeof inspectWorkspace, "function");
  const { root } = await fixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, "binary.dat"), Buffer.from([0, 255, 0, 128]));
  execFileSync("git", ["add", "--", "binary.dat"], { cwd: root });
  const snapshot = await inspectWorkspace(root);
  const patch = snapshot.git.patches.find((item) => item.path === "binary.dat");
  assert.equal(patch?.binary, true);
  assert.equal("text" in patch, false);
});

test("workspace capture redacts recognizable credentials from text patches", async (t) => {
  assert.equal(typeof inspectWorkspace, "function");
  const { root } = await fixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  const secret = "sk-proj-abcdefghijklmnop";
  await writeFile(join(root, "old name 雪.txt"), `exposed=${secret}\n`);
  const snapshot = await inspectWorkspace(root);
  const patchText = snapshot.git.patches.map((patch) => patch.text ?? "").join("\n");
  assert.equal(patchText.includes(secret), false);
  assert.equal(patchText.includes("[REDACTED:credential pattern]"), true);
  assert.equal(snapshot.git.warnings.some((warning) => warning.code === "CREDENTIALS_REDACTED"), true);
});

test("workspace comparison requires explicit acceptance after a relevant change", async (t) => {
  assert.equal(typeof inspectWorkspace, "function");
  const { root } = await fixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  const previous = await inspectWorkspace(root);
  await writeFile(join(root, "old name 雪.txt"), "changed after capture\n");
  const current = await inspectWorkspace(root);
  assert.notEqual(previous.digest, current.digest);
  assert.throws(() => compareWorkspace(previous, current), (error) => error.code === "WORKSPACE_MISMATCH");
  assert.equal(compareWorkspace(previous, current, true)[0].code, "WORKSPACE_MISMATCH_ACCEPTED");
});
