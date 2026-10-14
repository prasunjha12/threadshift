import { createHash } from "node:crypto";
import { stat } from "node:fs/promises";
import { resolve } from "node:path";
import { ThreadShiftError } from "../../core/errors.js";
import type { CaptureResult, JsonValue, RawRecord, Warning } from "../../core/types.js";
import { normalizeCodex, safeRawRecord } from "./normalize.js";
import { CodexAppServerClient } from "./client.js";
import { requireCompatibleVersion } from "../../runtime/compatibility.js";
import { resolveHarness, runProcess } from "../../runtime/process.js";

interface CaptureOptions {
  sessionId: string;
  executable?: string;
  argsPrefix?: string[];
  codexHome?: string;
  runtimeVersion?: string;
  maxCaptureBytes?: number;
  cwd?: string;
}

interface ThreadData {
  id?: string;
  name?: string;
  cwd?: string;
  status?: { type?: string };
  [key: string]: JsonValue | undefined;
}

function object(value: JsonValue | undefined): Record<string, JsonValue> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, JsonValue> : undefined;
}

function without(value: Record<string, JsonValue>, key: string): Record<string, JsonValue> {
  const copy = { ...value };
  delete copy[key];
  return copy;
}

function hash(value: JsonValue): string {
  return `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
}

async function detectCodexVersion(executable: string, argsPrefix: string[], cwd: string): Promise<string> {
  const result = await runProcess({ executable, args: [...argsPrefix, "--version"], cwd, timeoutMs: 5_000, maxOutputBytes: 16 * 1024 });
  if (result.exitCode !== 0) throw new ThreadShiftError("Could not read the Codex CLI version", "UNSUPPORTED_RUNTIME");
  const version = result.stdout.match(/codex-cli\s+(\d+\.\d+\.\d+)/i)?.[1];
  if (!version) throw new ThreadShiftError("Codex CLI returned an unrecognized version string", "UNSUPPORTED_RUNTIME");
  return version;
}

export async function captureCodex(options: CaptureOptions, signal?: AbortSignal): Promise<CaptureResult> {
  const maxCaptureBytes = options.maxCaptureBytes ?? 64 * 1024 * 1024;
  if (!Number.isSafeInteger(maxCaptureBytes) || maxCaptureBytes <= 0) throw new ThreadShiftError("Capture limit must be a positive integer", "CODEX_PROTOCOL");
  const cwd = resolve(options.cwd ?? process.cwd());
  const harness = await resolveHarness("codex", options.executable);
  const argsPrefix = options.argsPrefix ?? harness.argsPrefix;
  const runtimeVersion = options.runtimeVersion ?? await detectCodexVersion(harness.executable, argsPrefix, cwd);
  requireCompatibleVersion("codex", runtimeVersion);
  const codexHome = options.codexHome ? resolve(options.codexHome) : undefined;
  if (codexHome) {
    try {
      if (!(await stat(codexHome)).isDirectory()) throw new Error("not a directory");
    } catch {
      throw new ThreadShiftError("The selected Codex home must already exist; ThreadShift does not create source stores.", "INVALID_ARGUMENT");
    }
  }
  const env = { ...process.env };
  if (codexHome) env.CODEX_HOME = codexHome;
  const client = new CodexAppServerClient({
    executable: harness.executable,
    args: [...argsPrefix, "app-server", "--stdio"],
    cwd,
    env,
    maxOutputBytes: maxCaptureBytes * 2 + 1024 * 1024,
  });

  try {
    await client.request("initialize", {
      clientInfo: { name: "threadshift", title: "ThreadShift", version: "0.1.0" },
      capabilities: { experimentalApi: true },
    }, 30_000, signal);
    client.notify("initialized", {});
    const readSnapshot = async (): Promise<{ thread: ThreadData; turns: JsonValue[] }> => {
      const response = await client.request("thread/read", { threadId: options.sessionId, includeTurns: false }, 30_000, signal);
      const thread = object(object(response)?.thread);
      if (!thread) throw new ThreadShiftError("Codex thread/read response did not contain a thread", "CODEX_PROTOCOL");
      if (thread.id !== options.sessionId) throw new ThreadShiftError("Codex returned a different session than requested", "CODEX_PROTOCOL");
      if (object(thread.status)?.type === "active") throw new ThreadShiftError("Pause the Codex session at a turn boundary, then retry the export", "SOURCE_ACTIVE");
      const turns: JsonValue[] = [];
      const turnIds = new Set<string>();
      const cursors = new Set<string>();
      let cursor: string | null = null;
      for (let pageNumber = 0; pageNumber < 100_000; pageNumber++) {
        const pageResponse = await client.request("thread/turns/list", {
          threadId: options.sessionId,
          itemsView: "full",
          sortDirection: "asc",
          cursor,
          limit: 100,
        }, 30_000, signal);
        const pageObject = object(pageResponse);
        const data = pageObject?.data;
        if (!Array.isArray(data)) throw new ThreadShiftError("Codex turn page did not contain its records", "CODEX_PROTOCOL");
        for (const turnValue of data) {
          const turn = object(turnValue);
          if (!turn || !Array.isArray(turn.items)) throw new ThreadShiftError("Codex returned a turn without full persisted items", "CODEX_PROTOCOL");
          if (turn.status === "inProgress") throw new ThreadShiftError("Pause the Codex session at a turn boundary, then retry the export", "SOURCE_ACTIVE");
          if (typeof turn.id !== "string" || turnIds.has(turn.id)) throw new ThreadShiftError("Codex turn pagination returned a missing or duplicate turn ID", "CODEX_PROTOCOL");
          turnIds.add(turn.id);
          turns.push(turnValue);
        }
        if (!pageObject || !Object.hasOwn(pageObject, "nextCursor")) throw new ThreadShiftError("Codex turn page did not include its continuation cursor", "CODEX_PROTOCOL");
        const nextCursor = pageObject?.nextCursor;
        if (nextCursor === null) return { thread: thread as ThreadData, turns };
        if (typeof nextCursor !== "string" || cursors.has(nextCursor)) throw new ThreadShiftError("Codex turn pagination returned an invalid or repeated cursor", "CODEX_PROTOCOL");
        cursors.add(nextCursor);
        cursor = nextCursor;
      }
      throw new ThreadShiftError("Codex turn pagination exceeded the safety page limit", "CAPTURE_TOO_LARGE");
    };
    const first = await readSnapshot();
    const second = await readSnapshot();
    if (JSON.stringify(first) !== JSON.stringify(second)) throw new ThreadShiftError("Codex session changed during capture; retry after it is idle", "SOURCE_CHANGED");

    const rawRecords: RawRecord[] = [];
    const warnings: Warning[] = [];
    const exclusions: string[] = [];
    const warningRecords: { warning: Warning; rawId: string }[] = [];
    const safeAdd = (locator: string, value: JsonValue): void => {
      const id = `raw-${rawRecords.length + 1}`;
      const safe = safeRawRecord(id, locator, value);
      rawRecords.push(safe.record);
      warningRecords.push(...safe.warnings.map((warning) => ({ warning, rawId: id })));
      exclusions.push(...safe.exclusions);
    };
    const threadRecord = first.thread as unknown as Record<string, JsonValue>;
    safeAdd(`thread/${options.sessionId}`, threadRecord);
    for (const [turnIndex, value] of first.turns.entries()) {
      const turn = object(value);
      if (!turn) throw new ThreadShiftError(`Codex turn ${turnIndex} is malformed`, "CODEX_PROTOCOL");
      const turnId = typeof turn.id === "string" ? turn.id : `turn-${turnIndex + 1}`;
      const items = turn.items;
      safeAdd(`thread/${options.sessionId}/turn/${turnId}`, without(turn, "items"));
      if (!Array.isArray(items)) throw new ThreadShiftError(`Codex turn ${turnId} did not include its items`, "CODEX_PROTOCOL");
      for (const [itemIndex, item] of items.entries()) {
        if (!object(item)) throw new ThreadShiftError(`Codex item ${turnId}/${itemIndex} is malformed`, "CODEX_PROTOCOL");
        const sourceItem = object(item)!;
        const itemId = typeof sourceItem.id === "string" ? sourceItem.id : `item-${itemIndex + 1}`;
        safeAdd(`thread/${options.sessionId}/turn/${turnId}/item/${itemId}`, item);
      }
    }
    if (Buffer.byteLength(JSON.stringify(rawRecords), "utf8") > maxCaptureBytes) throw new ThreadShiftError("Codex session exceeded the capture limit; no records were truncated", "CAPTURE_TOO_LARGE");
    const normalized = normalizeCodex(rawRecords);
    for (const { warning, rawId } of warningRecords) {
      warning.eventIds = normalized.events.filter((event) => event.rawRecordIds.includes(rawId)).map((event) => event.id);
      warnings.push(warning);
    }
    for (const warning of normalized.warnings) warnings.push(warning);
    const sourceDigest = hash(rawRecords as unknown as JsonValue);
    return {
      source: {
        harness: "codex",
        runtimeVersion,
        sessionId: options.sessionId,
        captureMechanism: "app-server-thread-turns-list",
        workingDirectory: typeof first.thread.cwd === "string" ? first.thread.cwd : cwd,
      },
      events: normalized.events,
      rawRecords,
      warnings,
      sourceDigest,
      completeness: "complete",
      exclusions: [...new Set(exclusions)],
    };
  } finally {
    await client.close();
  }
}
