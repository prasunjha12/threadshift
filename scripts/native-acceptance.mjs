// Opt-in evidence collection; never certifies model understanding automatically.
import { spawnSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
if (args.includes("--help") || args.length === 0) {
  console.log("node scripts/native-acceptance.mjs --session ID --workspace DIR --output NEW_DIR [--codex-home DIR] [--launch --provider-kind real|native-local-fixture]");
  process.exit(0);
}
const launch = args.includes("--launch");
const providerIndex = args.indexOf("--provider-kind");
const providerKind = providerIndex >= 0 ? args[providerIndex + 1] : "none";
if (launch && !["real", "native-local-fixture"].includes(providerKind)) throw new Error("Explicit launch requires --provider-kind real or native-local-fixture");
const forwarded = providerIndex < 0 ? [...args] : args.filter((_, index) => index !== providerIndex && index !== providerIndex + 1);
const outputIndex = forwarded.indexOf("--output");
if (outputIndex < 0 || !forwarded[outputIndex + 1]) throw new Error("--output NEW_DIR is required");
const output = resolve(forwarded[outputIndex + 1]);
const cli = fileURLToPath(new URL("../dist/cli.js", import.meta.url));
const result = spawnSync(process.execPath, [cli, "handoff", "--from", "codex", "--to", "opencode", ...forwarded, "--json"], {
  encoding: "utf8", timeout: 11 * 60 * 1000, windowsHide: true,
});
process.stdout.write(result.stdout ?? "");
process.stderr.write(result.stderr ?? "");
if (result.status !== 0) process.exit(result.status ?? 1);
const report = JSON.parse(result.stdout);
if (report.preparation !== "prepared") throw new Error("Native evidence collection requires prepared output, not dry run");
const bundle = JSON.parse(await readFile(join(output, "session.threadshift.json"), "utf8"));
const evidence = {
  checkedAt: new Date().toISOString(), platform: process.platform, architecture: process.arch,
  nodeVersion: process.version, source: report.source, destination: report.destination,
  bundleId: bundle.manifest.bundleId, sourceDigest: bundle.manifest.sourceDigest,
  workspaceDigest: bundle.manifest.workspaceDigest,
  preservedCounts: report.preservedCounts, selectedCounts: report.selectedCounts,
  exclusions: bundle.manifest.exclusions, providerKind,
  launch: report.launch ?? { status: "not-run" },
  sourceInventoryComparison: "pending-independent-count-comparison",
  nativeContinuationAcceptance: "pending-manual-response-and-no-replay-audit",
};
await writeFile(join(output, "native-evidence.json"), JSON.stringify(evidence, null, 2) + "\n", { flag: "wx" });
