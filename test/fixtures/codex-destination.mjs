import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
if (process.argv.includes("--version")) { console.log("codex-cli 0.162.1"); process.exit(0); }
const mode = process.env.THREADSHIFT_CODEX_MODE ?? "success";
const chunks = []; for await (const chunk of process.stdin) chunks.push(chunk);
const input = Buffer.concat(chunks).toString("utf8");
await writeFile(join(process.cwd(), "destination-input.json"), JSON.stringify({ args: process.argv.slice(2), stdin: input }));
if (mode === "wait") { setInterval(() => {}, 1000); } else {
  const contract = JSON.parse(await readFile(new URL("./codex-delivery-contract.json", import.meta.url), "utf8"));
  let events = structuredClone(contract.success);
  if (mode === "identity-only") events = events.slice(0, 1);
  if (mode === "tool-only") events = [...events.slice(0, 2), { type: "item.completed", item: { type: "command_execution", exit_code: 0 } }];
  if (mode === "failed-turn") events = contract.syntheticFailureCases[1];
  if (mode === "error-after-success") events.push({ type: "error", message: "synthetic error" });
  if (mode === "conflicting-identity") events.splice(1, 0, { type: "thread.started", thread_id: "00000000-0000-4000-8000-000000000002" });
  if (mode === "missing-id") delete events[0].thread_id;
  if (mode === "unstarted-turn") events = [events[0], events.at(-1)];
  if (mode === "malformed-id") events[0].thread_id = "SYNTHETIC_INVALID_ID";
  if (mode === "malformed") console.log("not JSON"); else for (const event of events) console.log(JSON.stringify(event));
  if (mode === "nonzero") process.exitCode = 1;
}
