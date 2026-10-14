import { redactRecord } from "../../core/redact.js";
import type { CaptureResult, Event, JsonValue, RawRecord, Warning } from "../../core/types.js";

function object(value: JsonValue): Record<string, JsonValue> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, JsonValue> : undefined;
}

function textFromContent(content: JsonValue | undefined): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.map((part) => {
    const item = object(part);
    if (item?.type === "text" && typeof item.text === "string") return item.text;
    if (item?.type === "image" || item?.type === "localImage") return "[image input]";
    return "";
  }).filter(Boolean).join("\n");
}

function itemType(value: Record<string, JsonValue>): string {
  return typeof value.type === "string" ? value.type : "unknown";
}

export function normalizeCodex(records: RawRecord[]): { events: Event[]; warnings: Warning[] } {
  const events: Event[] = [];
  const warnings: Warning[] = [];
  const callIds = new Set<string>();
  const push = (event: Omit<Event, "order">): void => {
    events.push({ ...event, order: events.length });
  };

  for (const raw of records) {
    if (!raw.sourceLocator.includes("/item/")) continue;
    const item = object(raw.value);
    if (!item) continue;
    const type = itemType(item);
    const sourceId = typeof item.id === "string" ? item.id : raw.id;
    const common = { id: `${raw.sourceLocator}:${sourceId}`, sourceId, rawRecordIds: [raw.id] };
    if (type === "userMessage") {
      push({ ...common, kind: "user", text: textFromContent(item.content) });
    } else if (type === "agentMessage") {
      push({ ...common, kind: "assistant", text: typeof item.text === "string" ? item.text : "" });
    } else if (type === "plan") {
      push({ ...common, kind: "plan", text: typeof item.text === "string" ? item.text : "" });
    } else if (type === "commandExecution" || type === "mcpToolCall") {
      const callId = `${common.id}:call`;
      callIds.add(callId);
      const callDescription = type === "commandExecution"
        ? `Command: ${typeof item.command === "string" ? item.command : "unknown"}\nDirectory: ${typeof item.cwd === "string" ? item.cwd : "unknown"}`
        : `MCP tool: ${typeof item.server === "string" ? item.server : "unknown"}/${typeof item.tool === "string" ? item.tool : "unknown"}\nArguments: ${JSON.stringify(item.arguments ?? null)}`;
      push({ ...common, id: `${common.id}:call`, kind: "tool-call", callId, text: callDescription });
      const result = type === "commandExecution"
        ? `Status: ${typeof item.status === "string" ? item.status : "unknown"}\nExit code: ${typeof item.exitCode === "number" ? item.exitCode : "unknown"}\nOutput:\n${typeof item.aggregatedOutput === "string" ? item.aggregatedOutput : ""}`
        : `Status: ${typeof item.status === "string" ? item.status : "unknown"}\nResult: ${JSON.stringify(item.result ?? item.error ?? null)}`;
      push({ ...common, id: `${common.id}:result`, kind: "tool-result", callId, text: result });
    } else {
      const id = `${common.id}:unknown`;
      push({ ...common, id, kind: "unknown" });
      if (type !== "reasoning") warnings.push({ code: "UNKNOWN_EVENT_PRESERVED", message: `Codex item type '${type}' is preserved as historical raw data.`, eventIds: [id] });
    }
  }

  // A tool result can only reference a call created from the same historical item.
  for (const event of events) {
    if (event.kind === "tool-result" && (!event.callId || !callIds.has(event.callId))) {
      warnings.push({ code: "ORPHAN_TOOL_RESULT", message: "Historical tool result has no matching call in the readable session records.", eventIds: [event.id] });
    }
  }
  return { events, warnings };
}

export function safeRawRecord(id: string, locator: string, value: JsonValue): { record: RawRecord; warnings: Warning[]; exclusions: string[] } {
  const type = object(value)?.type;
  let safeValue = value;
  const exclusions: string[] = [];
  const warnings: Warning[] = [];
  if (type === "reasoning") {
    const item = object(value);
    if (item) {
      const safe = { ...item };
      if ("content" in safe) {
        safe.content = "[EXCLUDED: non-user-visible reasoning content]";
        exclusions.push("reasoning.content");
      }
      if ("summary" in safe) {
        safe.summary = "[EXCLUDED: non-user-visible reasoning summary]";
        exclusions.push("reasoning.summary");
      }
      safeValue = safe;
      warnings.push({ code: "REASONING_CONTENT_EXCLUDED", message: "Non-user-visible Codex reasoning fields were excluded from the portable bundle.", eventIds: [] });
    }
  }
  const redacted = redactRecord(safeValue);
  warnings.push(...redacted.warnings);
  return { record: { id, sourceLocator: locator, value: redacted.value }, warnings, exclusions };
}
