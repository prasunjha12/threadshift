import { ThreadShiftError } from "../../core/errors.js";
import type { Warning } from "../../core/types.js";
import { object, type PiObject, type PiSelectedDocument } from "./format.js";
function malformed(): never {
  throw new ThreadShiftError(
    "Pi context edit or compaction cannot be projected safely",
    "PI_PROTOCOL",
  );
}
export function projectPiEntries(document: PiSelectedDocument): {
  entries: { entryId: string; value: PiObject; sourceEntryIds: string[] }[];
  omittedEntryIds: string[];
  editedEntryIds: string[];
  warnings: Warning[];
} {
  const path = document.entries;
  let retained = path;
  let compactionIndex = -1;
  for (let index = 0; index < path.length; index++)
    if (path[index]?.type === "compaction") compactionIndex = index;
  if (compactionIndex >= 0) {
    const c = path[compactionIndex]!;
    const anchor = path.findIndex((e) => e.id === c.firstKeptEntryId);
    if (anchor < 0 || anchor > compactionIndex || typeof c.summary !== "string")
      malformed();
    retained = [
      c,
      ...path
        .slice(anchor, compactionIndex)
        .filter((e) => object(e.message)?.role !== "system"),
      ...path.slice(compactionIndex + 1),
    ];
  }
  const edits = new Map<string, PiObject>();
  for (const entry of retained)
    if (entry.type === "context_edit") {
      if (typeof entry.targetId !== "string") malformed();
      const target = path.find((e) => e.id === entry.targetId);
      if (!target || path.indexOf(target) >= path.indexOf(entry)) malformed();
      if (
        !(
          target.type === "custom_message" ||
          (target.type === "message" &&
            ["user", "assistant", "toolResult"].includes(
              String(object(target.message)?.role),
            ))
        )
      )
        malformed();
      const r = object(entry.replacement);
      if (
        entry.replacement !== null &&
        (!r || !(typeof r.content === "string" || Array.isArray(r.content)))
      )
        malformed();
      edits.set(entry.targetId, entry);
    }
  const entries: {
    entryId: string;
    value: PiObject;
    sourceEntryIds: string[];
  }[] = [];
  const editedEntryIds: string[] = [];
  for (const entry of retained) {
    if (
      !["message", "custom_message", "branch_summary", "compaction"].includes(
        String(entry.type),
      )
    )
      continue;
    if (entry.type === "message" && object(entry.message)?.role === "system")
      continue;
    if (entry.type === "compaction" && entry !== retained[0]) continue;
    const edit = edits.get(String(entry.id));
    if (edit) editedEntryIds.push(String(entry.id));
    if (edit?.replacement === null) continue;
    const value = structuredClone(entry);
    if (edit) {
      const replacement = object(edit.replacement)!;
      if (value.type === "message")
        object(value.message)!.content = structuredClone(replacement.content!);
      else value.content = structuredClone(replacement.content!);
    }
    entries.push({
      entryId: String(entry.id),
      value,
      sourceEntryIds: [
        String(entry.id),
        ...(edit ? [String(edit.id)] : []),
        ...(compactionIndex >= 0 ? [String(path[compactionIndex]!.id)] : []),
      ],
    });
  }
  const ids = new Set(entries.map((e) => e.entryId));
  return {
    entries,
    omittedEntryIds: path
      .filter((e) => !ids.has(String(e.id)))
      .map((e) => String(e.id)),
    editedEntryIds,
    warnings: [],
  };
}
