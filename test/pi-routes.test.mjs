import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
const cli = resolve("dist/cli.js"),
  fixture = (n) => resolve("test/fixtures/" + n);
const run = (args, env = {}) => {
  const p = spawnSync(process.execPath, [cli, ...args, "--json"], {
    encoding: "utf8",
    env: { ...process.env, ...env },
    timeout: 40000,
    windowsHide: true,
  });
  return { code: p.status, body: JSON.parse(p.stdout), stderr: p.stderr };
};
async function setup() {
  const root = await mkdtemp(resolve("work/pi-routes-")),
    workspace = join(root, "workspace");
  await mkdir(workspace);
  const git = spawnSync("git", ["init", "--quiet"], {cwd: workspace, windowsHide: true});
  assert.equal(git.status, 0);
  const home = join(root, "codex-home-normal");
  await mkdir(home);
  const native = JSON.parse(
    await readFile(fixture("opencode-native-contract.json"), "utf8"),
  );
  await writeFile(
    join(workspace, "source-fixture.json"),
    JSON.stringify({ data: native }),
  );
  const pi = JSON.parse(
    await readFile(fixture("pi-session-contract.json"), "utf8"),
  );
  pi.header.cwd = workspace;
  const source = join(root, "source.jsonl");
  await writeFile(
    source,
    [pi.header, ...pi.entries].map(JSON.stringify).join("\n") + "\n",
  );
  return { root, workspace, home, native, source };
}
function argsFor(s, from, to, output) {
  const bins = {
    codex:
      from === "codex"
        ? fixture("codex-server.mjs")
        : fixture("codex-destination.mjs"),
    opencode:
      from === "opencode"
        ? fixture("opencode-source.mjs")
        : fixture("opencode-server.mjs"),
    pi: fixture("pi-destination.mjs"),
  };
  return [
    "handoff",
    "--from",
    from,
    "--to",
    to,
    "--session",
    from === "pi"
      ? s.source
      : from === "codex"
        ? "00000000-0000-4000-8000-000000000001"
        : s.native.info.id,
    "--workspace",
    s.workspace,
    "--output",
    output,
    `--${from}-bin`,
    bins[from],
    `--${to}-bin`,
    bins[to],
    ...(from === "codex" ? ["--codex-home", s.home] : []),
    ...(from === "pi" ? ["--pi-leaf", "a4"] : []),
  ];
}
test("all six cross-agent routes prepare", async () => {
  const s = await setup();
  for (const from of ["codex", "opencode", "pi"])
    for (const to of ["codex", "opencode", "pi"])
      if (from !== to) {
        const out = join(s.root, `${from}-${to}`);
        const r = run(argsFor(s, from, to, out));
        assert.equal(r.code, 0, JSON.stringify(r));
        assert.equal(r.body.source.harness, from);
        assert.equal(r.body.destination.harness, to);
        if (from === "pi") {
          assert.equal(r.body.source.selection.selectedEntries, 4);
          const archive = await readFile(
            join(out, "session.threadshift.json"),
            "utf8",
          );
          assert.equal(archive.includes("SIBLING_EXCLUDED_MARKER"), false);
        }
      }
});
test("unknown same-agent and irrelevant Pi flags are rejected", () => {
  for (const args of [
    ["handoff", "--from", "pi", "--to", "pi", "--session", "x"],
    ["export", "--from", "codex", "--session", "x", "--pi-home", "x"],
    ["import", "--bundle", "x", "--to", "codex", "--pi-leaf", "x"],
    ["import", "--bundle", "x", "--to", "codex", "--pi-bin", "x"],
  ])
    assert.equal(run(args).body.error.code, "INVALID_ARGUMENT");
});
test("Pi-source incomplete launch never invokes destination but prepares for review", async () => {
  const s = await setup();
  const text = await readFile(s.source, "utf8");
  await writeFile(
    s.source,
    text.replaceAll('"stopReason":"stop"', '"stopReason":"error"'),
  );
  const args = argsFor(s, "pi", "codex", join(s.root, "incomplete"));
  const prepare = run(args);
  assert.equal(prepare.code, 0, JSON.stringify(prepare));
  const launch = run([...args, "--overwrite", "--launch"]);
  assert.equal(launch.body.error.code, "SOURCE_INCOMPLETE");
});
test("both fixture round trips preserve effective intermediate Pi state and first bundle citation", async () => {
  for (const origin of ["codex", "opencode"]) {
    const s = await setup();
    const first = join(s.root, "first");
    const forward = run([...argsFor(s, origin, "pi", first), "--launch"]);
    assert.equal(forward.code, 0, JSON.stringify(forward));
    const firstContext = await readFile(join(first, "continuation.md"), "utf8");
    const b = JSON.parse(
      await readFile(join(first, "session.threadshift.json"), "utf8"),
    );
    const doc = JSON.parse(
      await readFile(fixture("pi-session-contract.json"), "utf8"),
    );
    doc.header.cwd = s.workspace;
    doc.header.id = "pi-round-trip";
    doc.entries[0].message.content =
      "Objective: preserve parser interface\nAttributed first continuation: " +
      "Selected requirement: Fix parser Unicode handling. Keep the parser interface; earlier test failure is historical." +
      "\nFirst bundle: " +
      b.manifest.bundleId;
    doc.entries[2].message.content = "EDITED_AWAY_REQUEST";
    doc.entries[3].message.content = [
      {
        type: "text",
        text: "Pi decision: preserve parse(value). Trim implemented; null remains. Historical test failed.",
        textSignature: "PRIVATE_PI_ROUNDTRIP",
      },
    ];
    doc.entries.push({
      type: "context_edit",
      id: "e1",
      parentId: "a4",
      targetId: "a3",
      replacement: {
        content:
          "Current request: add null regression and rerun tests. Current state: trim implemented.",
      },
    });
    await writeFile(
      s.source,
      [doc.header, ...doc.entries].map(JSON.stringify).join("\n") + "\n",
    );
    const original = await readFile(s.source, "utf8");
    const output = join(s.root, "back");
    const args = argsFor(s, "pi", origin, output);
    args[args.indexOf("--pi-leaf") + 1] = "e1";
    const back = run([...args, "--launch"]);
    assert.equal(back.code, 0, JSON.stringify(back));
    assert.equal(back.body.launch.status, "launched");
    const text = await readFile(join(output, "continuation.md"), "utf8");
    for (const marker of [
      "EDITED_AWAY_REQUEST",
      "SIBLING_EXCLUDED_MARKER",
      "PRIVATE_PI_ROUNDTRIP",
    ])
      assert.equal(text.includes(marker), false, marker);
    assert.ok(text.includes(b.manifest.bundleId));
    assert.match(text, /Pi decision/);
    assert.match(text, /null regression/);
    assert.match(text, /Historical test failed/);
    assert.notEqual(back.body.source.sessionId, b.source.sessionId);
    assert.equal(await readFile(s.source, "utf8"), original);
  }
});
test("collector never certifies its own Pi continuation and reports inventory selection", async () => {
  const s = await setup();
  const output = join(s.root, "collector");
  const args = argsFor(s, "pi", "codex", output).slice(1);
  const p = spawnSync(
    process.execPath,
    [resolve("scripts/native-acceptance.mjs"), ...args],
    { encoding: "utf8", timeout: 40000, windowsHide: true },
  );
  assert.equal(p.status, 0, p.stdout + p.stderr);
  const evidence = JSON.parse(
    await readFile(join(output, "native-evidence.json"), "utf8"),
  );
  assert.equal(evidence.source.selection.selectedEntries, 4);
  assert.equal(evidence.nativeSourceCounts.selectedEntries, 4);
  assert.match(evidence.sourceInventoryComparison, /pending/);
  assert.match(evidence.nativeContinuationAcceptance, /pending/);
});
test('Pi native reserved ID exports with a portable bundle filename',async()=>{const s=await setup();const rows=(await readFile(s.source,'utf8')).trim().split('\n').map(JSON.parse);rows[0].id='CON';await writeFile(s.source,rows.map(JSON.stringify).join('\n')+'\n');const r=run(['export','--from','pi','--session',s.source,'--workspace',s.workspace,'--pi-bin',fixture('pi-destination.mjs'),'--pi-leaf','a4'],{USERPROFILE:s.root,HOME:s.root});assert.equal(r.code,0,JSON.stringify(r));assert.ok(r.body.path.endsWith(r.body.bundleId+'.threadshift.json'));const b=JSON.parse(await readFile(r.body.path,'utf8'));assert.equal(b.source.sessionId,'CON');});
test('Pi collector failed launch retains package and pending evidence',async()=>{const s=await setup();const output=join(s.root,'collector-failed');const args=argsFor(s,'codex','pi',output).slice(1);const p=spawnSync(process.execPath,[resolve('scripts/native-acceptance.mjs'),...args,'--launch','--provider-kind','native-local-fixture'],{encoding:'utf8',timeout:40000,windowsHide:true,env:{...process.env,PI_TEST_MODE:'aborted'}});assert.equal(p.status,1,p.stdout+p.stderr);const e=JSON.parse(await readFile(join(output,'native-evidence.json'),'utf8'));assert.equal(e.launch.status,'failed');assert.match(e.nativeContinuationAcceptance,/pending/);assert.ok((await readFile(join(output,'continuation.md'),'utf8')).length);});
