import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { ThreadShiftError } from "../../core/errors.js";
import type { JsonValue } from "../../core/types.js";
import { resolveHarness, terminateProcessTree } from "../../runtime/process.js";

export type JsonObject = { [key: string]: JsonValue };
export interface OpenCodeSnapshot {
  session: JsonObject;
  messages: { info: JsonObject; parts: JsonObject[] }[];
  state: "idle" | "active" | "unknown";
  terminalBoundary: boolean;
  coverageComplete: boolean;
}
export interface OpenCodeReadOptions {
  sessionId: string;
  cwd: string;
  executable?: string;
  maxCaptureBytes?: number;
  timeoutMs?: number;
}
function object(value: unknown): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ThreadShiftError("OpenCode returned an invalid record", "OPENCODE_PROTOCOL");
  return value as JsonObject;
}

/** Only GET operations against a private, unregistered helper: never start the managed service. */
export async function readOpenCodeSnapshot(options: OpenCodeReadOptions, signal?: AbortSignal): Promise<OpenCodeSnapshot> {
  if (signal?.aborted) throw new ThreadShiftError("Capture was cancelled", "PROCESS_CANCELLED");
  const harness = await resolveHarness("opencode", options.executable);
  if (signal?.aborted) throw new ThreadShiftError("Capture was cancelled", "PROCESS_CANCELLED");
  const password = randomBytes(32).toString("hex");
  const child = spawn(harness.executable, [...harness.argsPrefix, "serve", "--stdio", "--hostname", "127.0.0.1", "--port", "0"], {
    cwd: options.cwd, shell: false, windowsHide: true, detached: process.platform !== "win32",
    env: { ...process.env, OPENCODE_SERVER_PASSWORD: password, OPENCODE_SERVER_USERNAME: "opencode" }, stdio: ["pipe", "pipe", "pipe"],
  });
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  signal?.addEventListener("abort", onAbort, { once: true });
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 30000);
  const closed = new Promise<void>(resolve => child.once("close", () => resolve()));
  let closedAlready = false;
  child.once("close", () => { closedAlready = true; });
  child.stderr.on("data", () => undefined);
  let totalBytes = 0;
  const maxBytes = options.maxCaptureBytes ?? 64 * 1024 * 1024;
  try {
    const origin = await new Promise<string>((resolve, reject) => {
      let buffer = "";
      const fail = () => reject(new ThreadShiftError("OpenCode reader did not become ready", "OPENCODE_PROTOCOL"));
      const aborted = () => reject(new ThreadShiftError(signal?.aborted ? "Capture was cancelled" : "OpenCode reader timed out", signal?.aborted ? "PROCESS_CANCELLED" : "PROCESS_TIMEOUT"));
      controller.signal.addEventListener("abort", aborted, { once: true });
      child.once("error", fail); child.once("close", fail);
      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => {
        buffer += chunk;
        if (Buffer.byteLength(buffer) > 16384) { fail(); return; }
        if (!buffer.includes("\n")) return;
        try {
          const ready = object(JSON.parse(buffer.split("\n")[0]!));
          if (typeof ready.url !== "string") throw new Error();
          const url = new URL(ready.url);
          if (url.protocol !== "http:" || url.hostname !== "127.0.0.1" || !url.port || url.username || url.password || url.search || url.hash || url.pathname !== "/") throw new Error();
          controller.signal.removeEventListener("abort", aborted);
          resolve(url.origin);
        } catch { fail(); }
      });
    });
    const request = async (path: string): Promise<JsonObject> => {
      const response = await fetch(new URL(path, origin), {
        signal: controller.signal, redirect: "error",
        headers: { authorization: `Basic ${Buffer.from(`opencode:${password}`).toString("base64")}` },
      });
      if (!response.ok) { await response.body?.cancel(); throw new ThreadShiftError(`OpenCode source read failed (HTTP ${response.status})`, "OPENCODE_PROTOCOL"); }
      const chunks: Uint8Array[] = [];
      if (!response.body) throw new ThreadShiftError("OpenCode returned an empty response", "OPENCODE_PROTOCOL");
      for await (const chunk of response.body) {
        totalBytes += chunk.byteLength;
        if (totalBytes > maxBytes) { controller.abort(); throw new ThreadShiftError("OpenCode session exceeded the capture limit; no records were truncated", "CAPTURE_TOO_LARGE"); }
        chunks.push(chunk);
      }
      try { return object(JSON.parse(Buffer.concat(chunks).toString("utf8"))); }
      catch { throw new ThreadShiftError("OpenCode returned malformed JSON records", "OPENCODE_PROTOCOL"); }
    };
    const base = `/api/session/${encodeURIComponent(options.sessionId)}`;
    const session = object((await request(base)).data);
    if (session.id !== options.sessionId) throw new ThreadShiftError("OpenCode returned a different source session", "OPENCODE_PROTOCOL");
    const messages: OpenCodeSnapshot["messages"] = [];
    const ids = new Set<string>(), cursors = new Set<string>();
    let cursor: string | undefined;
    let complete = false;
    for (let pageNumber = 0; pageNumber < 100000; pageNumber++) {
      const query = new URLSearchParams({ limit: "100", ...(cursor ? { cursor } : { order: "asc" }) });
      const page = await request(`${base}/message?${query}`);
      if (!Array.isArray(page.data)) throw new ThreadShiftError("OpenCode message page omitted its records", "OPENCODE_PROTOCOL");
      const paging = object(page.cursor);
      if (!Object.hasOwn(paging, "next")) throw new ThreadShiftError("OpenCode page omitted its continuation cursor", "OPENCODE_PROTOCOL");
      for (const value of page.data) {
        const message = object(value);
        if (typeof message.id !== "string" || ids.has(message.id) || typeof message.type !== "string") throw new ThreadShiftError("OpenCode returned missing or duplicate message identity", "OPENCODE_PROTOCOL");
        ids.add(message.id);
        const time = object(message.time);
        if (typeof time.created !== "number" || !Number.isFinite(time.created) || Math.abs(time.created) > 8640000000000000) throw new ThreadShiftError("OpenCode returned invalid message timing", "OPENCODE_PROTOCOL");
        if (message.type === "assistant" && !Array.isArray(message.content)) throw new ThreadShiftError("OpenCode assistant record omitted its content", "OPENCODE_PROTOCOL");
        const parts = message.type === "assistant" ? (message.content as JsonValue[]).map(object) : [];
        const info = { ...message }; if (message.type === "assistant") delete info.content;
        messages.push({ info, parts });
      }
      if (page.data.length === 0 && paging.next === null) { complete = true; break; }
      if (typeof paging.next !== "string" || !paging.next || cursors.has(paging.next)) throw new ThreadShiftError("OpenCode pagination returned an invalid or repeated cursor", "OPENCODE_PROTOCOL");
      cursor = paging.next; cursors.add(cursor);
    }
    if (!complete) throw new ThreadShiftError("OpenCode pagination exceeded the safety page limit", "CAPTURE_TOO_LARGE");
    const active = messages.some(({ info, parts }) =>
      (info.type === "assistant" && object(info.time).completed === undefined) ||
      ((info.type === "shell" || info.type === "compaction") && info.status === "running") ||
      parts.some(part => part.type === "tool" && ["running", "streaming", "pending"].includes(String(object(part.state).status))));
    const last = messages.at(-1)?.info;
    const sessionTime = object(session.time);
    const unknownToolState = messages.some(({ parts }) => parts.some(part => part.type === "tool" && !["streaming", "running", "pending", "completed", "error"].includes(String(object(part.state).status))));
    const terminalBoundary = !unknownToolState && last?.type === "idle" && ["succeeded", "failed", "interrupted"].includes(String(last.outcome)) && last.outcome === session.outcome && object(last.time).created === sessionTime.idle;
    return { session, messages, state: active ? "active" : terminalBoundary ? "idle" : "unknown", terminalBoundary, coverageComplete: complete };
  } catch (error) {
    if (error instanceof ThreadShiftError) throw error;
    if (controller.signal.aborted) throw new ThreadShiftError(signal?.aborted ? "Capture was cancelled" : "OpenCode reader timed out", signal?.aborted ? "PROCESS_CANCELLED" : "PROCESS_TIMEOUT");
    throw new ThreadShiftError("OpenCode source protocol failed", "OPENCODE_PROTOCOL");
  } finally {
    clearTimeout(timer); signal?.removeEventListener("abort", onAbort);
    child.stdin.on("error", () => undefined); child.stdin.end();
    let grace: NodeJS.Timeout | undefined;
    await Promise.race([closed, new Promise<void>(resolve => { grace = setTimeout(resolve, 300); })]); clearTimeout(grace);
    if (!closedAlready) {
      terminateProcessTree(child);
      let deadline: NodeJS.Timeout | undefined;
      await Promise.race([closed, new Promise<void>(resolve => { deadline = setTimeout(resolve, 3000); })]); clearTimeout(deadline);
      if (!closedAlready) { child.kill("SIGKILL"); child.stdin.destroy(); child.stdout.destroy(); child.stderr.destroy(); }
    }
  }
}
