import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

test("tarball installs offline and exposes the CLI without source or scratch data", async (t) => {
  const scratch = join(process.cwd(), "work", "package-tests");
  await mkdir(scratch, { recursive: true });
  const directory = await mkdtemp(join(scratch, "run-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const npmCli = process.env.npm_execpath;
  assert.ok(npmCli, "Run through npm run test:package");
  const npm = (args, cwd = process.cwd()) => execFileSync(process.execPath, [npmCli, ...args], {
    cwd, encoding: "utf8", timeout: 60000, windowsHide: true,
  });
  const [packed] = JSON.parse(npm(["pack", "--json", "--pack-destination", directory]));
  const names = packed.files.map((file) => file.path);
  assert.ok(names.includes("dist/cli.js"));
  assert.ok(names.includes("README.md"));
  assert.ok(names.includes("docs/usage.md"));
  assert.ok(names.every((name) => !/^(src|test|work|node_modules|\.git|\.superpowers)\//.test(name)));
  assert.ok(names.every((name) => !name.endsWith(".threadshift.json")));
  const consumer = join(directory, "consumer 雪");
  await mkdir(consumer);
  await writeFile(join(consumer, "package.json"), '{"name":"threadshift-consumer","private":true}');
  npm(["install", "--offline", "--ignore-scripts", "--no-audit", "--no-fund", join(directory, packed.filename)], consumer);
  const metadata = JSON.parse(await readFile(join(consumer, "node_modules", "threadshift", "package.json"), "utf8"));
  assert.equal(metadata.bin.threadshift, "./dist/cli.js");
  const output = npm(["exec", "--offline", "--", "threadshift", "--help"], consumer);
  assert.match(output, /threadshift handoff/);
  const installedCli = join(consumer, "node_modules", "threadshift", "dist", "cli.js");
  const error = execFileSync(process.execPath, [installedCli, "--help"], { encoding: "utf8" });
  assert.match(error, /--launch/);
});
