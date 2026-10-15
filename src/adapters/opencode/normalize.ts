import type { Event, JsonValue, RawRecord, Warning } from "../../core/types.js";

function object(value: JsonValue | undefined): Record<string, JsonValue> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value : undefined;
}
export function normalizeOpenCode(records: RawRecord[]): { events: Event[]; warnings: Warning[] } {
  const events: Event[] = [], warnings: Warning[] = [];
  const push = (raw: RawRecord, kind: Event["kind"], text?: string, suffix = "", callId?: string) => {
    const value = object(raw.value)!;
    const timestamp = object(value.time)?.created;
    const event: Event = { id: raw.sourceLocator + suffix, order: events.length, kind, rawRecordIds: [raw.id], ...(typeof value.id === "string" ? { sourceId: value.id } : {}), ...(typeof text === "string" ? { text } : {}), ...(typeof timestamp === "number" ? { timestamp: new Date(timestamp).toISOString() } : {}), ...(callId ? { callId } : {}) };
    events.push(event); return event;
  };
  for (const raw of records) {
    if (!raw.sourceLocator.includes("/message/")) continue;
    const value = object(raw.value); if (!value) continue;
    if (!raw.sourceLocator.includes("/content/") && value.type === "assistant") continue;
    if (value.type === "idle") continue;
    if (value.type === "user") { push(raw, "user", typeof value.text === "string" ? value.text : ""); continue; }
    if (value.type === "text" && raw.sourceLocator.includes("/content/")) { push(raw, "assistant", typeof value.text === "string" ? value.text : ""); continue; }
    if (value.type === "tool" && typeof value.id === "string" && typeof value.name === "string") {
      const state = object(value.state);
      if (state && object(state.input) && ["completed", "error"].includes(String(state.status))) {
        const callId = `${raw.sourceLocator}/call/${value.id}`;
        push(raw, "tool-call", `Tool: ${value.name}\nArguments: ${JSON.stringify(state.input ?? null)}`, ":call", callId);
        push(raw, "tool-result", `Status: ${String(state.status)}\nResult: ${JSON.stringify(state.content ?? state.error ?? null)}`, ":result", callId);
        continue;
      }
    }
    if (value.type === "plan") { push(raw, "plan", typeof value.text === "string" ? value.text : ""); continue; }
    const event = push(raw, "unknown");
    if (value.type !== "reasoning") warnings.push({ code: "UNKNOWN_EVENT_PRESERVED", message: "An OpenCode record without a normalized representation is preserved as historical raw data.", eventIds: [event.id] });
  }
  return { events, warnings };
}
