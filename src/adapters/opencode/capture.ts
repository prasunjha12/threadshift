import { realpath, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { ThreadShiftError } from "../../core/errors.js";
import { sanitizeCapture } from "../../core/privacy.js";
import type { CaptureResult, JsonValue, RawRecord, Warning } from "../../core/types.js";
import { requireCompatibleVersion } from "../../runtime/compatibility.js";
import { resolveHarness, runProcess } from "../../runtime/process.js";
import { normalizeOpenCode } from "./normalize.js";
import { readOpenCodeSnapshot, type OpenCodeReadOptions } from "./protocol.js";

export async function captureOpenCode(options: Omit<OpenCodeReadOptions, "cwd"> & { cwd?: string }, signal?: AbortSignal): Promise<CaptureResult> {
  if (signal?.aborted) throw new ThreadShiftError("Capture was cancelled", "PROCESS_CANCELLED");
  const maxCaptureBytes = options.maxCaptureBytes ?? 64 * 1024 * 1024;
  if (!Number.isSafeInteger(maxCaptureBytes) || maxCaptureBytes <= 0 || (options.timeoutMs !== undefined && (!Number.isSafeInteger(options.timeoutMs) || options.timeoutMs <= 0))) throw new ThreadShiftError("Capture limits must be positive integers", "INVALID_ARGUMENT");
  const cwd = resolve(options.cwd ?? process.cwd());
  if (!(await stat(cwd)).isDirectory()) throw new ThreadShiftError("The selected workspace must exist", "INVALID_ARGUMENT");
  const harness = await resolveHarness("opencode", options.executable);
  const versionResult = await runProcess({ executable: harness.executable, args: [...harness.argsPrefix, "--version"], cwd, timeoutMs: 5000, maxOutputBytes: 16384 }, signal);
  const runtimeVersion = versionResult.stdout.match(/(?:opencode\s+)?v?(\d+\.\d+\.\d+)/i)?.[1];
  if (versionResult.exitCode !== 0 || !runtimeVersion) throw new ThreadShiftError("Could not read the OpenCode CLI version", "UNSUPPORTED_RUNTIME");
  requireCompatibleVersion("opencode", runtimeVersion);
  const readOptions = { ...options, cwd, maxCaptureBytes };
  const first = await readOpenCodeSnapshot(readOptions, signal);
  if (first.state === "active") throw new ThreadShiftError("Pause the OpenCode session at a completed boundary before capture", "SOURCE_ACTIVE");
  const location = first.session.location;
  const directory = location && typeof location === "object" && !Array.isArray(location) ? location.directory : undefined;
  if (typeof directory !== "string") throw new ThreadShiftError("OpenCode session omitted its workspace directory", "OPENCODE_PROTOCOL");
  let sameWorkspace = false;
  try { sameWorkspace = await realpath(directory) === await realpath(cwd); } catch {}
  if (!sameWorkspace) throw new ThreadShiftError("The OpenCode session belongs to a different workspace", "WORKSPACE_MISMATCH");
  const second = await readOpenCodeSnapshot(readOptions, signal);
  if (second.state === "active") throw new ThreadShiftError("OpenCode became active during capture", "SOURCE_ACTIVE");
  if (JSON.stringify(first) !== JSON.stringify(second)) throw new ThreadShiftError("OpenCode session changed during capture; retry after it is idle", "SOURCE_CHANGED");
  const warnings: Warning[] = [];
  const exclusions = new Set<string>();
  const rawRecords: RawRecord[] = [];
  const add = (sourceLocator: string, value: JsonValue) => {
    const safe = structuredClone(value);
    rawRecords.push({ id: `raw-${rawRecords.length + 1}`, sourceLocator, value: safe });
  };
  const base = `session/${options.sessionId}`;
  add(base, first.session);
  for (const message of first.messages) {
    const locator = `${base}/message/${String(message.info.id)}`;
    add(locator, message.info);
    message.parts.forEach((part, index) => add(`${locator}/content/${index}`, part));
  }
  const fork = first.session.fork !== undefined || first.session.parentID !== undefined;
  const complete = first.coverageComplete && first.terminalBoundary && !fork;
  if (!complete) warnings.push({ code: fork ? "OPENCODE_FORK_HISTORY_UNVERIFIED" : "OPENCODE_BOUNDARY_UNKNOWN", message: fork ? "Inherited fork or parent history was not independently accounted for; capture is incomplete." : "A completed source boundary could not be established; capture is incomplete.", eventIds: [] });
  const normalized = normalizeOpenCode(rawRecords);
  return sanitizeCapture({ source: { harness: "opencode", runtimeVersion, sessionId: options.sessionId, captureMechanism: "unregistered-api-paginated-messages", workingDirectory: directory }, events: normalized.events, rawRecords, warnings: [...warnings, ...normalized.warnings], sourceDigest: "sha256:uncomputed", completeness: complete ? "complete" : "incomplete", exclusions: [...exclusions] });
}
