import { spawn, type ChildProcess } from "node:child_process";
import { access, readFile } from "node:fs/promises";
import { delimiter, dirname, extname, join, resolve } from "node:path";

export interface ProcessSpec {
  executable: string;
  args: string[];
  cwd: string;
  env?: Record<string, string>;
  stdin?: string;
  timeoutMs: number;
  maxOutputBytes?: number;
}

export interface ProcessResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
}

export interface HarnessDescriptor {
  executable: string;
  argsPrefix: string[];
  wrapperPath?: string;
}

export class ProcessError extends Error {
  constructor(
    message: string,
    readonly code: "PROCESS_TIMEOUT" | "PROCESS_CANCELLED" | "EXECUTABLE_NOT_FOUND" | "PROCESS_FAILED" | "OUTPUT_LIMIT",
    readonly exitCode: number | null = null,
  ) {
    super(message);
    this.name = "ProcessError";
  }
}

// Our POSIX children own a process group; Windows taskkill enumerates the tree
// before killing its root, so descendants cannot become orphaned first.
export function terminateProcessTree(child: ChildProcess, onFailure?: (message: string) => void): void {
  const pid = child.pid;
  if (!pid) return;
  if (process.platform === "win32") {
    const killer = spawn(join(process.env.SystemRoot ?? "C:\\Windows", "System32", "taskkill.exe"), ["/PID", String(pid), "/T", "/F"], {
      windowsHide: true, stdio: "ignore", shell: false,
    });
    let done = false;
    const fallback = () => {
      if (done) return;
      done = true;
      clearTimeout(deadline);
      onFailure?.("Process-tree termination failed; the root was force-killed but descendant cleanup is unverified.");
      child.kill("SIGKILL");
    };
    const deadline = setTimeout(() => { killer.kill(); fallback(); }, 2000);
    deadline.unref();
    killer.once("error", fallback);
    killer.once("close", (code) => {
      if (code !== 0) fallback();
      else { done = true; clearTimeout(deadline); }
    });
    return;
  }
  const killGroup = (signal: NodeJS.Signals) => {
    try { process.kill(-pid, signal); }
    catch { if (child.exitCode === null) child.kill(signal); }
  };
  killGroup("SIGTERM");
  const escalation = setTimeout(() => killGroup("SIGKILL"), 250);
  escalation.unref();
}

export function runProcess(spec: ProcessSpec, signal?: AbortSignal): Promise<ProcessResult> {
  if (signal?.aborted) return Promise.reject(new ProcessError("Process cancelled", "PROCESS_CANCELLED"));
  return new Promise((resolvePromise, rejectPromise) => {
    let child;
    try {
      child = spawn(spec.executable, spec.args, {
        cwd: spec.cwd,
        env: spec.env ? { ...process.env, ...spec.env } : process.env,
        windowsHide: true,
        stdio: [spec.stdin === undefined ? "ignore" : "pipe", "pipe", "pipe"],
        shell: false,
        detached: process.platform !== "win32",
      });
    } catch (error) {
      rejectPromise(error);
      return;
    }

    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    const outputLimit = spec.maxOutputBytes ?? 64 * 1024 * 1024;
    let outputBytes = 0;
    let settled = false;
    let inputFinished = spec.stdin === undefined;
    let terminating: ProcessError | undefined;
    let terminationDeadline: NodeJS.Timeout | undefined;

    const finishError = (error: ProcessError) => {
      if (settled || terminating) return;
      terminating = error;
      child.stdin?.destroy();
      terminateProcessTree(child, (message) => { terminating = new ProcessError(`${error.message}. ${message}`, error.code); });
      terminationDeadline = setTimeout(() => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
        child.kill("SIGKILL");
        child.stdout!.destroy();
        child.stderr!.destroy();
        rejectPromise(new ProcessError(`${terminating?.message ?? error.message} Process close was not confirmed; descendant cleanup is unverified.`, error.code));
      }, 3000);
      terminationDeadline.unref();
    };
    const timer = setTimeout(() => finishError(new ProcessError("Process timed out", "PROCESS_TIMEOUT")), spec.timeoutMs);
    timer.unref();
    const onAbort = () => finishError(new ProcessError("Process cancelled", "PROCESS_CANCELLED"));
    signal?.addEventListener("abort", onAbort, { once: true });

    const collect = (target: Buffer[]) => (chunk: Buffer) => {
      outputBytes += chunk.length;
      if (outputBytes > outputLimit) {
        finishError(new ProcessError("Process output exceeded the configured limit", "OUTPUT_LIMIT"));
        return;
      }
      target.push(chunk);
    };
    child.stdout!.on("data", collect(stdout));
    child.stderr!.on("data", collect(stderr));
    if (child.stdin && spec.stdin !== undefined) {
      child.stdin.on("error", () => finishError(new ProcessError("Process closed its input unexpectedly", "PROCESS_FAILED")));
      child.stdin.end(spec.stdin, "utf8", () => { inputFinished = true; });
    }
    child.on("error", (error: NodeJS.ErrnoException) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(terminationDeadline);
      signal?.removeEventListener("abort", onAbort);
      rejectPromise(error.code === "ENOENT"
        ? new ProcessError(`Executable not found: ${spec.executable}`, "EXECUTABLE_NOT_FOUND")
        : new ProcessError(error.message, "PROCESS_FAILED"));
    });
    child.on("close", (exitCode) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(terminationDeadline);
      signal?.removeEventListener("abort", onAbort);
      if (terminating) {
        rejectPromise(new ProcessError(terminating.message, terminating.code, exitCode));
        return;
      }
      if (!inputFinished) { rejectPromise(new ProcessError("Process closed before accepting its input", "PROCESS_FAILED", exitCode)); return; }
      resolvePromise({
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
        exitCode,
      });
    });
  });
}

async function firstExisting(candidates: string[]): Promise<string | undefined> {
  for (const candidate of candidates) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      // Continue through the platform-specific search candidates.
    }
  }
  return undefined;
}

async function unwrapPowerShell(path: string): Promise<HarnessDescriptor> {
  const script = await readFile(path, "utf8");
  const basedir = dirname(path);
  const nodeScript = script.match(/"\$basedir\/node_modules\/([^"\r\n]+\.(?:c?js|mjs))"/i)?.[1];
  const directTarget = script.match(/&\s+"\$basedir\/([^"\r\n]+\.exe)"/i)?.[1];
  if (directTarget && !nodeScript) {
    const executable = resolve(basedir, directTarget.replaceAll("/", "/"));
    if (await firstExisting([executable])) return { executable, argsPrefix: [], wrapperPath: path };
  }

  if (nodeScript) {
    const nodeExe = await firstExisting([join(basedir, "node.exe"), join(basedir, "node"), process.execPath]);
    if (nodeExe) {
      const normalized = nodeScript.split("/").join("\\");
      const scriptPath = resolve(basedir, "node_modules", ...normalized.split("\\"));
      return { executable: nodeExe, argsPrefix: [scriptPath], wrapperPath: path };
    }
  }
  throw new ProcessError(`Unsupported PowerShell launcher format: ${path}`, "PROCESS_FAILED");
}

export async function resolveHarness(name: "codex" | "opencode", override?: string): Promise<HarnessDescriptor> {
  const isWindows = process.platform === "win32";
  const pathEntries = (process.env.PATH ?? "").split(delimiter);
  const names = isWindows ? [`${name}.exe`, `${name}.ps1`, `${name}.cmd`, name] : [name];
  const candidate = override
    ? resolve(override)
    : await firstExisting(pathEntries.flatMap((entry) => names.map((file) => join(entry, file))));
  if (!candidate) throw new ProcessError(`Could not find ${name}; install it or provide its executable path`, "EXECUTABLE_NOT_FOUND");

  if ([".js", ".cjs", ".mjs"].includes(extname(candidate).toLowerCase())) {
    return { executable: process.execPath, argsPrefix: [candidate] };
  }
  if (extname(candidate).toLowerCase() === ".ps1") return unwrapPowerShell(candidate);
  if (extname(candidate).toLowerCase() === ".cmd") {
    throw new ProcessError(`Windows command wrapper is unsupported; provide the package executable: ${candidate}`, "PROCESS_FAILED");
  }
  return { executable: candidate, argsPrefix: [] };
}
