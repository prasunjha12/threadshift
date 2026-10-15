import { projectPiContext } from "../adapters/pi/normalize.js";
import { ThreadShiftError } from "../core/errors.js";
import type { CaptureResult, Evidence, Event, HandoffState, JsonValue, Warning, WorkspaceSnapshot } from "../core/types.js";
import { redactRecord } from "../core/redact.js";

type FieldName = "objective" | "currentState" | "completed" | "decisions" | "remaining" | "blockers" | "nextActions" | "importantFiles" | "verificationState" | "activePlan";
const allowedFields = new Set<FieldName>([
  "objective", "currentState", "completed", "decisions", "remaining", "blockers", "nextActions", "importantFiles", "verificationState", "activePlan",
]);

function ordered(events: Event[]): Event[] {
  return [...events].sort((left, right) => left.order - right.order);
}

function explicitField(events: Event[], label: string): Evidence<string> | null {
  const expression = new RegExp(`^\\s*${label}\\s*:\\s*(.+?)\\s*$`, "i");
  for (const event of ordered(events).reverse()) {
    if (event.kind !== "user" || !event.text) continue;
    const value = event.text.split(/\r?\n/).map((line) => expression.exec(line)?.[1]).find(Boolean);
    if (value) return { value, origin: "source-stated", eventIds: [event.id] };
  }
  return null;
}

function parseUserFields(input: unknown): Partial<Record<FieldName, string | string[]>> {
  if (input === undefined || input === null) return {};
  if (typeof input !== "object" || Array.isArray(input)) throw new ThreadShiftError("Handoff fields must be a JSON object", "INVALID_HANDOFF_FIELDS");
  const fields = input as Record<string, unknown>;
  for (const key of Object.keys(fields)) {
    if (!allowedFields.has(key as FieldName)) throw new ThreadShiftError(`Unsupported handoff field '${key}'`, "INVALID_HANDOFF_FIELDS");
  }
  const parsed: Partial<Record<FieldName, string | string[]>> = {};
  for (const [key, value] of Object.entries(fields) as [FieldName, unknown][]) {
    if ((key === "objective" || key === "currentState") && typeof value !== "string") {
      throw new ThreadShiftError(`Handoff field '${key}' must be a single string`, "INVALID_HANDOFF_FIELDS");
    }
    if (typeof value === "string" && value.trim().length > 0 && value.length <= 20_000) {
      parsed[key] = value;
      continue;
    }
    if (Array.isArray(value) && value.length <= 100 && value.every((entry) => typeof entry === "string" && entry.trim().length > 0 && entry.length <= 20_000)) {
      parsed[key] = value as string[];
      continue;
    }
    throw new ThreadShiftError(`Handoff field '${key}' must be a non-empty string or an array of at most 100 non-empty strings`, "INVALID_HANDOFF_FIELDS");
  }
  return parsed;
}

function supplied(value: string | string[] | undefined): Evidence<string>[] {
  if (value === undefined) return [];
  const values = Array.isArray(value) ? value : [value];
  return values.map((entry) => ({ value: entry, origin: "user-supplied", eventIds: [] }));
}

export function sanitizeHandoffFields(input: unknown): { fields: Partial<Record<FieldName, string | string[]>>; warnings: Warning[] } {
  const parsed = parseUserFields(input);
  const sanitized = redactRecord(parsed as JsonValue);
  return { fields: sanitized.value as Partial<Record<FieldName, string | string[]>>, warnings: sanitized.warnings };
}

export function deriveHandoff(capture: Pick<CaptureResult, "events"> & Partial<Pick<CaptureResult, "source" | "rawRecords">>, _workspace: WorkspaceSnapshot, userFields?: unknown): HandoffState {
  const events = ordered(capture.source?.harness === "pi" && capture.rawRecords ? projectPiContext(capture.rawRecords, capture.source).events : capture.events);
  const fields = sanitizeHandoffFields(userFields).fields;
  const latestUser = events.filter((event) => event.kind === "user").at(-1);
  const objective = typeof fields.objective === "string"
    ? supplied(fields.objective)[0] ?? null
    : explicitField(events, "(?:Objective|Goal)");
  const currentState = typeof fields.currentState === "string"
    ? supplied(fields.currentState)[0] ?? null
    : explicitField(events, "Current state");
  const latestRequest = latestUser?.text === undefined
    ? null
    : { value: latestUser.text, origin: "source-stated" as const, eventIds: [latestUser.id] };
  return {
    objective,
    latestRequest,
    currentState,
    completed: supplied(fields.completed),
    decisions: supplied(fields.decisions),
    remaining: supplied(fields.remaining),
    blockers: supplied(fields.blockers),
    nextActions: supplied(fields.nextActions),
    importantFiles: supplied(fields.importantFiles),
    verificationState: supplied(fields.verificationState),
    activePlan: supplied(fields.activePlan),
  };
}
