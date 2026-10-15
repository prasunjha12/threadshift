import type {
  Event,
  JsonValue,
  RawRecord,
  ThreadShiftBundle,
  Warning,
} from "../../core/types.js";
import { object, readPiCanonical } from "./format.js";
import { projectPiEntries } from "./context.js";
export function normalizePi(records: RawRecord[]): {
  events: Event[];
  warnings: Warning[];
} {
  const events: Event[] = [];
  const warnings: Warning[] = [];
  const calls = new Set<string>();
  const push = (
    raw: RawRecord,
    kind: Event["kind"],
    text?: string,
    callId?: string,
    index = 0,
  ) => {
    const value = object(raw.value)!;
    events.push({
      id: `pi-event-${value.id}-${index}`,
      order: events.length,
      kind,
      sourceId: String(value.id),
      rawRecordIds: [raw.id],
      ...(text !== undefined ? { text } : {}),
      ...(callId ? { callId } : {}),
      ...(typeof value.timestamp === "string"
        ? { timestamp: value.timestamp }
        : {}),
    });
  };
  const visible = (value: JsonValue | undefined): string =>
    typeof value === "string"
      ? value
      : Array.isArray(value)
        ? value
            .map((p) => object(p))
            .filter((p) => p?.type === "text" && typeof p.text === "string")
            .map((p) => p!.text)
            .join("\n")
        : "";
  for (const raw of records) {
    const entry = object(raw.value);
    if (!entry || entry.type === "session") continue;
    if (entry.type === "message") {
      const m = object(entry.message);
      if (!m) continue;
      const role = m.role;
      if (role === "user") push(raw, "user", visible(m.content));
      else if (role === "assistant") {
        if (typeof m.content === "string") push(raw, "assistant", m.content);
        else if (Array.isArray(m.content))
          for (const [i, part] of m.content.entries()) {
            const p = object(part);
            if (p?.type === "text" && typeof p.text === "string")
              push(raw, "assistant", p.text, undefined, i);
            else if (p?.type === "toolCall" && typeof p.id === "string") {
              calls.add(p.id);
              push(
                raw,
                "tool-call",
                JSON.stringify({ name: p.name, arguments: p.arguments }),
                p.id,
                i,
              );
            }
          }
      } else if (role === "toolResult") {
        const id = typeof m.toolCallId === "string" ? m.toolCallId : undefined;
        if (id && calls.has(id))
          push(raw, "tool-result", visible(m.content), id);
        else {
          push(raw, "unknown", visible(m.content));
          warnings.push({
            code: "PI_ORPHAN_TOOL_RESULT",
            message: "Historical Pi result has no retained matching call",
            eventIds: [events.at(-1)!.id],
          });
        }
      }
    } else if (entry.type === "custom_message")
      push(raw, "unknown", visible(entry.content));
    else if (entry.type === "compaction" || entry.type === "branch_summary")
      push(
        raw,
        "plan",
        typeof entry.summary === "string"
          ? `Historical ${entry.type} checkpoint: ${entry.summary}`
          : undefined,
      );
    else push(raw, "unknown");
  }
  return { events, warnings };
}
export function projectPiContext(
  records: RawRecord[],
  source: ThreadShiftBundle["source"],
): {
  events: Event[];
  omittedEventIds: string[];
  editedEventIds: string[];
  warnings: Warning[];
} {
  const doc = readPiCanonical(records, source);
  const projected = projectPiEntries(doc);
  const byEntry = new Map(
    records.slice(1).map((r) => [String(object(r.value)?.id), r]),
  );
  const normalized = normalizePi(
    projected.entries.map((e) => ({
      ...byEntry.get(e.entryId)!,
      value: e.value,
    })),
  );
  for (const event of normalized.events) {
    const projection = projected.entries.find(
      (e) => e.entryId === event.sourceId,
    )!;
    event.rawRecordIds = [
      ...new Set(
        projection.sourceEntryIds
          .map((id) => byEntry.get(id)?.id)
          .filter((id): id is string => !!id),
      ),
    ];
  }
  const originals = normalizePi(records).events;
  const edited = new Set(projected.editedEntryIds);
  const effectiveIds = new Set(normalized.events.map((e) => e.id));
  return {
    ...normalized,
    omittedEventIds: originals
      .filter((e) => !effectiveIds.has(e.id))
      .map((e) => e.id),
    editedEventIds: originals
      .filter((e) => edited.has(e.sourceId!))
      .map((e) => e.id),
    warnings: [...projected.warnings, ...normalized.warnings],
  };
}
