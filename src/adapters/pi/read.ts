import { open, readdir, realpath, stat } from "node:fs/promises";
import { resolve, join, isAbsolute } from "node:path";
import { homedir } from "node:os";
import { ThreadShiftError } from "../../core/errors.js";
import { parsePiJsonl, selectPiBranch, piId, object } from "./format.js";
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
// Inspect only bounded headers within this project's store; filenames are not identities.
async function exactPiFiles(
  directory: string,
  id: string,
  signal?: AbortSignal,
): Promise<string[]> {
  let names: string[];
  try {
    names = await readdir(directory);
  } catch {
    throw new ThreadShiftError(
      "Pi session store not found",
      "PI_SESSION_NOT_FOUND",
    );
  }
  const matches: string[] = [];
  for (const name of names.filter((name) => name.endsWith(".jsonl"))) {
    aborted(signal);
    let handle;
    try {
      handle = await open(join(directory, name), "r");
    } catch {
      continue;
    }
    try {
      if (!(await handle.stat()).isFile()) continue;
      const chunks: Buffer[] = [];
      let size = 0;
      let newline = false;
      while (size < 64 * 1024 && !newline) {
        aborted(signal);
        const chunk = Buffer.alloc(Math.min(4096, 64 * 1024 - size));
        const read = await handle.read(chunk, 0, chunk.length, null);
        if (!read.bytesRead) break;
        const data = chunk.subarray(0, read.bytesRead);
        const index = data.indexOf(10);
        chunks.push(index >= 0 ? data.subarray(0, index) : data);
        size += read.bytesRead;
        newline = index >= 0;
      }
      if (!newline) continue;
      let header;
      try {
        header = object(
          JSON.parse(
            new TextDecoder("utf-8", { fatal: true }).decode(
              Buffer.concat(chunks),
            ),
          ),
        );
      } catch {
        continue;
      }
      if (header?.type === "session" && header.id === id)
        matches.push(join(directory, name));
    } finally {
      await handle.close();
    }
  }
  return matches.sort();
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
  let sourceDirectory: string | undefined;
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
    sourceDirectory = directory;
    const matches = await exactPiFiles(directory, selector, signal);
    if (matches.length !== 1)
      throw new ThreadShiftError(
        "Pi exact session identity is missing or ambiguous",
        "PI_SESSION_NOT_FOUND",
      );
    filePath = matches[0]!;
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
  if (sourceDirectory) {
    const matches = await exactPiFiles(sourceDirectory, selector, signal);
    if (matches.length !== 1 || matches[0] !== filePath)
      throw new ThreadShiftError(
        "Pi identity inventory changed during capture",
        "SOURCE_CHANGED",
      );
  }
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
