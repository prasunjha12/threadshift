import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { ThreadShiftError } from "../../core/errors.js";
import type { JsonValue } from "../../core/types.js";
import { terminateProcessTree } from "../../runtime/process.js";

interface RpcResponse {
  id?: number;
  result?: JsonValue;
  error?: { code?: number; message?: string };
}

interface PendingRequest {
  resolve: (value: JsonValue) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

export class CodexAppServerClient {
  private readonly child: ChildProcessWithoutNullStreams;
  private readonly pending = new Map<number, PendingRequest>();
  private buffer = "";
  private outputBytes = 0;
  private nextId = 1;
  private closed = false;
  private closePromise: Promise<void>;

  constructor(options: { executable: string; args: string[]; cwd: string; env: NodeJS.ProcessEnv; maxOutputBytes: number }) {
    this.child = spawn(options.executable, options.args, {
      cwd: options.cwd,
      detached: process.platform !== "win32",
      env: options.env,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
      shell: false,
    });
    this.child.stdout.setEncoding("utf8");
    this.child.stdout.on("data", (chunk: string) => this.onData(chunk, options.maxOutputBytes));
    this.child.stderr.on("data", () => undefined);
    this.child.on("error", (error: NodeJS.ErrnoException) => {
      const code = error.code === "ENOENT" ? "EXECUTABLE_NOT_FOUND" : "CODEX_PROTOCOL";
      this.fail(new ThreadShiftError(error.message, code));
    });
    this.closePromise = new Promise<void>((resolve) => this.child.once("close", () => {
      this.closed = true;
      this.fail(new ThreadShiftError("Codex app-server exited before responding", "CODEX_PROTOCOL"));
      resolve();
    }));
  }

  private fail(error: Error): void {
    for (const request of this.pending.values()) {
      clearTimeout(request.timer);
      request.reject(error);
    }
    this.pending.clear();
  }

  private onData(chunk: string, maxOutputBytes: number): void {
    this.outputBytes += Buffer.byteLength(chunk, "utf8");
    if (this.outputBytes > maxOutputBytes) {
      this.fail(new ThreadShiftError("Codex session exceeded the capture limit; no records were truncated", "CAPTURE_TOO_LARGE"));
      terminateProcessTree(this.child);
      return;
    }
    this.buffer += chunk;
    for (;;) {
      const newline = this.buffer.indexOf("\n");
      if (newline < 0) break;
      const line = this.buffer.slice(0, newline);
      this.buffer = this.buffer.slice(newline + 1);
      if (!line.trim()) continue;
      let message: RpcResponse;
      try {
        message = JSON.parse(line) as RpcResponse;
      } catch {
        this.fail(new ThreadShiftError("Codex app-server returned malformed JSON", "CODEX_PROTOCOL"));
        terminateProcessTree(this.child);
        return;
      }
      if (typeof message.id !== "number") continue;
      const pending = this.pending.get(message.id);
      if (!pending) continue;
      this.pending.delete(message.id);
      clearTimeout(pending.timer);
      if (message.error) {
        pending.reject(new ThreadShiftError(message.error.message ?? "Codex app-server request failed", "CODEX_PROTOCOL"));
      } else if (message.result === undefined) {
        pending.reject(new ThreadShiftError("Codex app-server response did not include a result", "CODEX_PROTOCOL"));
      } else {
        pending.resolve(message.result);
      }
    }
  }

  request(method: string, params: JsonValue, timeoutMs = 30_000, signal?: AbortSignal): Promise<JsonValue> {
    if (signal?.aborted) return Promise.reject(new ThreadShiftError("Capture was cancelled", "PROCESS_CANCELLED"));
    if (this.closed) return Promise.reject(new ThreadShiftError("Codex app-server is closed", "CODEX_PROTOCOL"));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new ThreadShiftError(`Codex app-server timed out during ${method}`, "PROCESS_TIMEOUT"));
        terminateProcessTree(this.child);
      }, timeoutMs);
      timer.unref();
      const onAbort = () => {
        this.pending.delete(id);
        clearTimeout(timer);
        reject(new ThreadShiftError("Capture was cancelled", "PROCESS_CANCELLED"));
        terminateProcessTree(this.child);
      };
      signal?.addEventListener("abort", onAbort, { once: true });
      this.pending.set(id, {
        resolve: (value) => { signal?.removeEventListener("abort", onAbort); resolve(value); },
        reject: (error) => { signal?.removeEventListener("abort", onAbort); reject(error); },
        timer,
      });
      try {
        this.child.stdin.write(`${JSON.stringify({ method, id, params })}\n`);
      } catch (error) {
        this.pending.delete(id);
        clearTimeout(timer);
        reject(new ThreadShiftError(String(error), "CODEX_PROTOCOL"));
      }
    });
  }

  notify(method: string, params: JsonValue): void {
    this.child.stdin.write(`${JSON.stringify({ method, params })}\n`);
  }

  async close(): Promise<void> {
    if (!this.closed) terminateProcessTree(this.child);
    let deadline: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        this.closePromise,
        new Promise<never>((_, reject) => {
          deadline = setTimeout(() => {
            this.child.kill("SIGKILL");
            this.child.stdin.destroy();
            this.child.stdout.destroy();
            this.child.stderr.destroy();
            reject(new ThreadShiftError("Codex process close was not confirmed; descendant cleanup is unverified.", "PROCESS_TIMEOUT"));
          }, 3000);
          deadline.unref();
        }),
      ]);
    } finally {
      clearTimeout(deadline);
    }
  }
}
