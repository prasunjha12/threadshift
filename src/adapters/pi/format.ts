import { ThreadShiftError } from "../../core/errors.js";
import type {
  JsonValue,
  PiBranchSelection,
  RawRecord,
  ThreadShiftBundle,
  Warning,
} from "../../core/types.js";
export type PiObject = { [key: string]: JsonValue };
export interface PiDocument {
  header: PiObject;
  entries: PiObject[];
}
export interface PiSelectedDocument extends PiDocument {
  selection: PiBranchSelection;
  completeness: "complete" | "incomplete";
  warnings: Warning[];
  exclusions: string[];
}
export const piId = /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/;
export function object(value: unknown): PiObject | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as PiObject)
    : undefined;
}
function protocol(): never {
  throw new ThreadShiftError(
    "Invalid or unsupported Pi session structure",
    "PI_PROTOCOL",
  );
}
function check(document: PiDocument): Map<string, PiObject> {
  const { header, entries } = document;
  if (
    header.type !== "session" ||
    header.version !== 3 ||
    typeof header.id !== "string" ||
    !piId.test(header.id) ||
    typeof header.cwd !== "string" ||
    !header.cwd
  )
    protocol();
  const byId = new Map<string, PiObject>();
  for (const entry of entries) {
    if (
      entry.type === "session" ||
      typeof entry.type !== "string" ||
      typeof entry.id !== "string" ||
      !piId.test(entry.id) ||
      byId.has(entry.id) ||
      !(entry.parentId === null || typeof entry.parentId === "string")
    )
      protocol();
    // Native files append parents before their children; this also rejects cycles.
    if (entry.parentId !== null && !byId.has(entry.parentId as string))
      protocol();
    byId.set(entry.id, entry);
  }
  return byId;
}
export function parsePiJsonl(text: string): PiDocument {
  try {
    const lines = text.split("\n");
    if (lines.at(-1)?.trim() === "") lines.pop();
    if (!lines.length || lines.some((line) => !line.trim())) protocol();
    const values = lines.map((line) => object(JSON.parse(line)) ?? protocol());
    const document = { header: values[0]!, entries: values.slice(1) };
    check(document);
    return document;
  } catch (error) {
    if (error instanceof ThreadShiftError) throw error;
    return protocol();
  }
}
export function selectPiBranch(
  document: PiDocument,
  options: { leafId?: string } = {},
): PiSelectedDocument {
  const byId = check(document);
  const parents = new Set(document.entries.map((e) => e.parentId));
  const leaves = document.entries.filter((e) => !parents.has(e.id));
  if (options.leafId !== undefined && !piId.test(options.leafId))
    throw new ThreadShiftError(
      "Invalid Pi leaf identifier",
      "INVALID_ARGUMENT",
    );
  if (!options.leafId && leaves.length > 1)
    throw new ThreadShiftError(
      "Pi has multiple branches; supply --pi-leaf explicitly",
      "PI_BRANCH_REQUIRED",
    );
  const leaf = options.leafId ? byId.get(options.leafId) : leaves[0];
  if (!leaf)
    throw new ThreadShiftError(
      "Selected Pi branch is missing or empty",
      "PI_SESSION_NOT_FOUND",
    );
  const entries: PiObject[] = [];
  let entry: PiObject | undefined = leaf;
  while (entry) {
    entries.push(entry);
    entry =
      entry.parentId === null ? undefined : byId.get(entry.parentId as string);
  }
  entries.reverse();
  let complete = true;
  let finalRole: string | undefined;
  let finalStop: string | undefined;
  const pending = new Set<string>();
  const known = new Set([
    "message",
    "context_edit",
    "compaction",
    "branch_summary",
    "custom_message",
    "custom",
    "usage",
    "model_change",
    "thinking_level_change",
    "label",
    "session_info",
  ]);
  for (const item of entries) {
    if (!known.has(String(item.type))) complete = false;
    if (item.type !== "message") continue;
    const message = object(item.message);
    if (!message || typeof message.role !== "string") protocol();
    if (["user", "assistant", "toolResult"].includes(message.role)) {
      finalRole = message.role;
      finalStop =
        typeof message.stopReason === "string" ? message.stopReason : undefined;
    } else if (message.role !== "system") complete = false;
    if (message.role === "assistant") {
      if (!Array.isArray(message.content)) protocol();
      for (const part of message.content) {
        const p = object(part);
        if (p?.type === "toolCall") {
          if (typeof p.id !== "string" || pending.has(p.id)) protocol();
          pending.add(p.id);
        }
      }
    }
    if (message.role === "toolResult") {
      if (
        typeof message.toolCallId !== "string" ||
        !pending.delete(message.toolCallId)
      )
        complete = false;
    }
  }
  if (
    pending.size ||
    finalRole === "user" ||
    finalRole === "toolResult" ||
    finalStop === "toolUse"
  )
    throw new ThreadShiftError(
      "Selected Pi branch has unfinished work",
      "SOURCE_ACTIVE",
    );
  if (finalRole !== "assistant" || finalStop !== "stop") complete = false;
  const inherited = typeof document.header.parentSession === "string" && !!document.header.parentSession;
  if (inherited) complete = false;
  const warnings: Warning[] = complete
    ? []
    : [
        {
          code: "PI_BOUNDARY_UNKNOWN",
          message:
            "Pi selected branch has no proven successful completed boundary",
          eventIds: [],
        },
      ];
  if (inherited) warnings.push({code: "PI_INHERITED_HISTORY_UNVERIFIED", message: "Inherited Pi history was not independently accounted for; parent files are not followed.", eventIds: []});
  return {
    header: structuredClone(document.header),
    entries: structuredClone(entries),
    selection: {
      kind: "pi-branch",
      leafId: leaf.id as string,
      totalEntries: document.entries.length,
      selectedEntries: entries.length,
      excludedEntries: document.entries.length - entries.length,
    },
    completeness: complete ? "complete" : "incomplete",
    warnings,
    exclusions: ["pi.unselected-branches", "pi.parent-session-content"],
  };
}
export function readPiCanonical(
  records: RawRecord[],
  source: ThreadShiftBundle["source"],
): PiSelectedDocument {
  try {
    const selection = source.selection;
    if (!selection || records.length !== selection.selectedEntries + 1)
      protocol();
    const prefix = `pi/session/${source.sessionId}/`;
    const header = object(records[0]?.value) ?? protocol();
    if (
      records[0]?.sourceLocator !== prefix + "header" ||
      header.id !== source.sessionId ||
      header.cwd !== source.workingDirectory
    )
      protocol();
    const entries = records.slice(1).map((raw) => {
      const entry = object(raw.value) ?? protocol();
      if (raw.sourceLocator !== prefix + `entry/${entry.id}`) protocol();
      return entry;
    });
    const result = selectPiBranch(
      { header, entries },
      { leafId: selection.leafId },
    );
    if (
      result.entries.length !== entries.length ||
      entries.at(-1)?.id !== selection.leafId ||
      result.entries.some((e, i) => e.id !== entries[i]?.id)
    )
      protocol();
    return { ...result, selection };
  } catch (error) {
    throw new ThreadShiftError(
      "Pi canonical history does not match its selected ancestry",
      "INVALID_BUNDLE",
      { cause: error },
    );
  }
}
