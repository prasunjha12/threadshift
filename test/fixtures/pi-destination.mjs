if (process.argv.includes("--version")) {
  console.log("1.0.2");
  process.exit(0);
}
import { readFile, appendFile } from "node:fs/promises";
import { join } from "node:path";
const chunks = [];
for await (const c of process.stdin) chunks.push(c);
const input = Buffer.concat(chunks).toString();
if (process.env.PI_TEST_LOG)
  await appendFile(
    process.env.PI_TEST_LOG,
    JSON.stringify({ args: process.argv.slice(2), cwd: process.cwd(), input }) +
      "\n",
  );
const contract = JSON.parse(
  await readFile(
    new URL("./pi-delivery-contract.json", import.meta.url),
    "utf8",
  ),
);
let events = structuredClone(contract.success);
const mode = process.env.PI_TEST_MODE;
if (mode === "header") events = events.slice(0, 1);
if (mode === "unsettled") events.pop();
if (mode === "conflict") events.push({ ...events[0], id: "other" });
if (mode === "late-turn") events.push({ type: "turn_start" });
if (mode === "late-error")
  events.push({ type: "error", message: "PRIVATE_NATIVE_ERROR" });
if (mode === "aborted") {
  events[3].message.stopReason = "aborted";
  events[4].message.stopReason = "aborted";
}
if (mode === "missing-final")
  events = events.filter((e) => e.type !== "message_end");
if (mode === "pending-tool")
  events.splice(3, 0, { type: "tool_execution_start", toolCallId: "pending" });
if (mode === "recovery") {
  events = [
    ...events.slice(0, 3),
    {
      type: "message_end",
      message: { role: "assistant", content: [], stopReason: "error" },
    },
    {
      type: "turn_end",
      message: { role: "assistant", content: [], stopReason: "error" },
    },
    { type: "agent_end" },
    { type: "auto_retry_start" },
    { type: "agent_start" },
    { type: "turn_start" },
    ...events.slice(3, 4),
    { type: "auto_retry_end", success: true },
    ...events.slice(4),
  ];
}
if (mode === "unicode") {
  events[3].message.content[0].text = "雪\u2028\u2029";
  events[4].message.content[0].text = "雪\u2028\u2029";
}

if (mode === "late-compaction")
  events.push({ type: "compaction_start", reason: "threshold" });
if (mode === "late-message")
  events.push(
    { type: "message_start", message: { role: "user", content: "new" } },
    { type: "agent_settled" },
  );
if (mode === "failed-compaction")
  events.splice(
    events.length - 1,
    0,
    { type: "compaction_start", reason: "threshold" },
    {
      type: "compaction_end",
      reason: "threshold",
      aborted: true,
      willRetry: false,
    },
  );
if (mode === "overflow-recovery") {
  const bad = { role: "assistant", content: [], stopReason: "error" };
  events = [
    ...events.slice(0, 3),
    { type: "message_end", message: bad },
    { type: "turn_end", message: bad },
    { type: "agent_end" },
    { type: "compaction_start", reason: "overflow" },
    {
      type: "compaction_end",
      reason: "overflow",
      result: {
        summary: "checkpoint",
        firstKeptEntryId: "a1",
        tokensBefore: 100,
      },
      aborted: false,
      willRetry: true,
    },
    ...events.slice(1),
  ];
}
if (mode === "threshold-compaction") events.splice(events.length-1,0,{type:"compaction_start",reason:"threshold"},{type:"compaction_end",reason:"threshold",result:{summary:"checkpoint",firstKeptEntryId:null,tokensBefore:100},aborted:false,willRetry:false});
for (const e of events) process.stdout.write(JSON.stringify(e) + "\r\n");
if (mode === "truncated") process.stdout.write("{");
process.exitCode = mode === "nonzero" ? 1 : 0;
