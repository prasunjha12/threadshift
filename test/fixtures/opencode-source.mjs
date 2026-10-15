import { createServer } from "node:http";
import { readFile, writeFile, appendFile } from "node:fs/promises";
import { join } from "node:path";

const root = process.cwd();
const input = JSON.parse(await readFile(join(root, "source-fixture.json"), "utf8"));
if (process.argv.includes("--version")) { console.log(input.version ?? "2.0.22"); process.exit(0); }
if (input.mode === "early-exit") process.exit(2);
let started = 0;
try { started = Number(await readFile(join(root, "starts.txt"), "utf8")); } catch {}
await writeFile(join(root, "starts.txt"), String(++started));
const data = structuredClone(input.data);
data.info.location.directory = input.mode === "wrong-workspace" ? join(root, "different-project") : root;
if (input.mode === "wrong-session") data.info.id = "ses_other";
if (input.mode === "changed" && started > 1) data.messages[0].text = "Different source request";
if (input.mode === "active") delete data.messages[1].time.completed;
if (input.mode === "running-tool") data.messages[1].content[1].state.status = "running";
if (input.mode === "unknown-tool-state") data.messages[1].content[1].state.status = "future-state";
if (input.mode === "tied-time") data.messages[0].time.created = data.messages[1].time.created;
if (input.mode === "unknown-boundary") data.messages.pop();
if (input.mode === "fork") data.info.fork = { sessionID: "ses_parent", boundary: { type: "through", messageID: "msg_parent" } };
if (input.mode === "duplicate") data.messages[1].id = data.messages[0].id;
if (input.mode === "unknown") data.messages[1].content.push({ type: "future-part", safeMetadata: "preserve me" });
if (input.mode === "orphan") data.messages.splice(2, 0, { id: "msg_orphan", type: "tool-result", callID: "missing", text: "orphan result", time: { created: 2500 } });
if (input.mode === "media") data.messages[0].files = [{ data: "SYNTHETIC_INLINE_MEDIA", mime: "image/png", source: { type: "uri", uri: "https://example.invalid/image.png" } }];
if (input.mode === "oversize") data.messages[0].text = "x".repeat(16000);
if (input.mode === "malformed-part") data.messages[1].content = [null];

const server = createServer(async (req, res) => {
  const url = new URL(req.url, "http://127.0.0.1");
  await appendFile(join(root, "requests.jsonl"), JSON.stringify({ method: req.method, path: url.pathname, query: Object.fromEntries(url.searchParams) }) + "\n");
  const send = (value, status = 200) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(value)); };
  const expected = `Basic ${Buffer.from(`opencode:${process.env.OPENCODE_SERVER_PASSWORD}`).toString("base64")}`;
  if (req.headers.authorization !== expected) return send({ error: "unauthorized" }, 401);
  if (input.mode === "stall") return;
  if (input.mode === "malformed") { res.end("not JSON"); return; }
  if (input.mode === "redirect") { res.writeHead(302, { location: "https://example.invalid/" }); res.end(); return; }
  const base = `/api/session/${encodeURIComponent(input.data.info.id)}`;
  if (url.pathname === base) return send({ data: data.info });
  if (url.pathname !== `${base}/message` || req.method !== "GET") return send({ error: "unexpected operation" }, 400);
  if (url.searchParams.has("cursor") && url.searchParams.has("order")) return send({ error: "cursor cannot be combined with order" }, 400);
  const index = Number(url.searchParams.get("cursor") ?? 0);
  if (input.mode === "missing-cursor") return send({ data: [] });
  const items = data.messages.slice(index, index + 1);
  return send({ data: items, cursor: { previous: null, next: items.length ? (input.mode === "cursor-loop" ? "0" : String(index + 1)) : null } });
});
server.listen(0, "127.0.0.1", () => {
  console.log(JSON.stringify({ url: input.mode === "remote-url" ? "https://example.invalid" : `http://127.0.0.1:${server.address().port}` }));
});
process.stdin.resume();
process.stdin.on("end", () => { server.closeAllConnections(); server.close(() => process.exit(0)); });
