import { open, readdir, realpath, stat } from "node:fs/promises";
import { resolve, join, isAbsolute } from "node:path";
import { homedir } from "node:os";
import { ThreadShiftError } from "../../core/errors.js";
import { parsePiJsonl, selectPiBranch, piId } from "./format.js";
function aborted(signal?: AbortSignal): void {
  if (signal?.aborted)
    throw new ThreadShiftError("Pi read cancelled", "PROCESS_CANCELLED");
}
export async function readStablePiText(
  readSnapshot: () => Promise<{ text: string; identity: string }>,
  signal?: AbortSignal,
): Promise<string> {
  aborted(signal);
  const first = await readSnapshot();
  aborted(signal);
  const second = await readSnapshot();
  aborted(signal);
  if (first.identity !== second.identity || first.text !== second.text)
    throw new ThreadShiftError(
      "Selected Pi session changed during capture",
      "SOURCE_CHANGED",
    );
  return second.text;
}
export async function readPiSource(
  options: {
    sessionId: string;
    cwd: string;
    piHome?: string;
    executable?: string;
    leafId?: string;
    maxCaptureBytes?: number;
  },
  signal?: AbortSignal,
) {
  const limit = options.maxCaptureBytes ?? 64 * 1024 * 1024;
  if (!Number.isSafeInteger(limit) || limit < 1)
    throw new ThreadShiftError("Invalid Pi capture limit", "INVALID_ARGUMENT");
  const cwd = await realpath(resolve(options.cwd));
  const selector = options.sessionId;
  let filePath: string;
  const explicitFile = isAbsolute(selector) || selector.endsWith(".jsonl");
  if (explicitFile) filePath = resolve(selector);
  else {
    if (!piId.test(selector))
      throw new ThreadShiftError(
        "Select an exact Pi ID or JSONL file",
        "INVALID_ARGUMENT",
      );
    const home = resolve(
      options.piHome ??
        process.env.PI_CODING_AGENT_DIR ??
        join(homedir(), ".pi", "agent"),
    );
    const encoded = `--${cwd.replace(/^[/\\]/, "").replace(/[/\\:]/g, "-")}--`;
    const directory =
      process.env.PI_CODING_AGENT_SESSION_DIR ??
      join(home, "sessions", encoded);
    let names: string[];
    try {
      names = await readdir(directory);
    } catch {
      throw new ThreadShiftError(
        "Pi session store not found",
        "PI_SESSION_NOT_FOUND",
      );
    }
    const matches = names.filter((name) => name.endsWith(`_${selector}.jsonl`));
    if (matches.length !== 1)
      throw new ThreadShiftError(
        "Pi exact session identity is missing or ambiguous",
        "PI_SESSION_NOT_FOUND",
      );
    filePath = join(directory, matches[0]!);
  }
  const snapshot = async () => {
    aborted(signal);
    let handle;
    try {
      handle = await open(filePath, "r");
    } catch {
      throw new ThreadShiftError(
        "Selected Pi session file cannot be read",
        "PI_SESSION_NOT_FOUND",
      );
    }
    try {
      const before = await handle.stat({ bigint: true });
      if (!before.isFile())
        throw new ThreadShiftError(
          "Pi source must be a regular file",
          "PI_SESSION_NOT_FOUND",
        );
      if (before.size > BigInt(limit))
        throw new ThreadShiftError(
          "Pi source exceeds capture limit",
          "CAPTURE_TOO_LARGE",
        );
      const buffer = Buffer.alloc(Number(before.size) + 1);
      let count = 0;
      while (count < buffer.length) {
        aborted(signal);
        const read = await handle.read(
          buffer,
          count,
          buffer.length - count,
          null,
        );
        if (!read.bytesRead) break;
        count += read.bytesRead;
      }
      if (count > limit)
        throw new ThreadShiftError(
          "Pi source exceeds capture limit",
          "CAPTURE_TOO_LARGE",
        );
      const after = await handle.stat({ bigint: true });
      const pathStat = await stat(filePath, { bigint: true });
      const identity = (s: typeof before) =>
        `${s.dev}:${s.ino}:${s.size}:${s.mtimeNs}:${s.ctimeNs}`;
      if (
        identity(before) !== identity(after) ||
        identity(after) !== identity(pathStat) ||
        BigInt(count) !== after.size
      )
        throw new ThreadShiftError(
          "Pi source changed during read",
          "SOURCE_CHANGED",
        );
      return {
        text: new TextDecoder("utf-8", { fatal: true }).decode(
          buffer.subarray(0, count),
        ),
        identity: identity(after),
      };
    } finally {
      await handle.close();
    }
  };
  const document = parsePiJsonl(await readStablePiText(snapshot, signal));
  if (!explicitFile && document.header.id !== selector)
    throw new ThreadShiftError("Pi source identity mismatch", "PI_PROTOCOL");
  let sourceCwd: string;
  try {
    sourceCwd = await realpath(String(document.header.cwd));
  } catch {
    throw new ThreadShiftError(
      "Pi source workspace is unavailable",
      "WORKSPACE_MISMATCH",
    );
  }
  if (sourceCwd !== cwd)
    throw new ThreadShiftError(
      "Pi source belongs to a different workspace",
      "WORKSPACE_MISMATCH",
    );
  return {
    ...selectPiBranch(
      document,
      options.leafId ? { leafId: options.leafId } : {},
    ),
    filePath,
  };
}
