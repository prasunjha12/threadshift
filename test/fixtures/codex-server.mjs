import { appendFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";

if (process.argv.includes("--version")) {
  process.stdout.write("codex-cli 0.162.1\n");
  process.exit(0);
}

const home = process.env.CODEX_HOME;
const logPath = join(home, "requests.jsonl");
const mode = home.split(/[\\/]/).at(-1).replace(/^codex-home-/, "");
await mkdir(dirname(logPath), { recursive: true });
let input = "";
let reads = 0;

function threadFor(mode) {
  const status = mode === "active" ? { type: "active", activeFlags: [] } : { type: "notLoaded" };
  const thread = {
    id: "00000000-0000-4000-8000-000000000001",
    name: "Fixture task",
    cwd: "C:/fixture project",
    status,
    createdAt: 1_791_857_600,
    turns: [
      {
        id: "turn-1",
        status: "completed",
        startedAt: 1_791_857_600,
        completedAt: 1_791_857_620,
        items: [
          { type: "userMessage", id: "user-1", content: [{ type: "text", text: "Fix parser; preserve \"snow 雪\"" }] },
          { type: "agentMessage", id: "assistant-1", phase: "final_answer", text: "I will update parser.ts." },
          { type: "commandExecution", id: "command-1", command: "npm test", cwd: "C:/fixture project", status: "completed", aggregatedOutput: "1 failing test", exitCode: 1 },
          { type: "plan", id: "plan-1", text: "Update parser then add a regression case." },
          { type: "futureItemType", id: "future-1", payload: { marker: "preserve me" } },
          { type: "reasoning", id: "reasoning-1", summary: ["Private reasoning summary"], content: [{ type: "text", text: "private reasoning detail" }] },
        ],
      },
      ...(mode === "pagination" ? [{
        id: "turn-2",
        status: "completed",
        startedAt: 1_791_857_700,
        completedAt: 1_791_857_720,
        items: [
          { type: "userMessage", id: "user-2", content: [{ type: "text", text: "Second page 雪" }] },
          { type: "agentMessage", id: "assistant-2", phase: "final_answer", text: "Second page captured." },
        ],
      }] : []),
    ],
  };
    if (mode === "malformed") delete thread.turns;
    if (mode === "changing") thread.updatedAt = reads;
  return thread;
}

for await (const chunk of process.stdin) {
  input += chunk;
  for (;;) {
    const index = input.indexOf("\n");
    if (index < 0) break;
    const line = input.slice(0, index);
    input = input.slice(index + 1);
    if (!line.trim()) continue;
    const request = JSON.parse(line);
    await appendFile(logPath, `${JSON.stringify(request)}\n`);
    if (request.id === undefined) continue;
    if (request.method === "initialize") {
      process.stdout.write(`${JSON.stringify({ id: request.id, result: { userAgent: "fixture", codexHome: home, platformFamily: "windows", platformOs: "windows" } })}\n`);
    } else if (request.method === "thread/read") {
      reads++;
      const thread = threadFor(mode);
      delete thread.turns;
      process.stdout.write(`${JSON.stringify({ id: request.id, result: { thread } })}\n`);
    } else if (request.method === "thread/turns/list") {
      const turns = threadFor(mode).turns;
      const page = request.params.cursor === "page-2" ? turns.slice(1) : mode === "pagination" ? turns.slice(0, 1) : turns;
      const nextCursor = mode === "cursor-loop" ? "page-2" : mode === "pagination" && request.params.cursor == null ? "page-2" : null;
      const result = { data: page, nextCursor, backwardsCursor: null };
      if (mode === "missing-cursor") delete result.nextCursor;
      process.stdout.write(`${JSON.stringify({ id: request.id, result })}\n`);
    } else {
      process.stdout.write(`${JSON.stringify({ id: request.id, error: { code: -32601, message: "method not found" } })}\n`);
    }
  }
}
