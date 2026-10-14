import { ThreadShiftError } from "./errors.js";
import { assertSafeIdentifier } from "./privacy-paths.js";
import type { Event, HandoffState, JsonValue, RawRecord, ThreadShiftBundle, Warning } from "./types.js";

function record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ThreadShiftError(`${label} must be an object`, "INVALID_BUNDLE");
  }
  return value as Record<string, unknown>;
}

function string(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) throw new ThreadShiftError(`${label} must be a non-empty string`, "INVALID_BUNDLE");
  return value;
}

function stringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
    throw new ThreadShiftError(`${label} must be an array of strings`, "INVALID_BUNDLE");
  }
  return value as string[];
}

function isJson(value: unknown, seen = new Set<object>()): value is JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value !== "object") return false;
  if (seen.has(value)) return false;
  seen.add(value);
  const valid = Array.isArray(value)
    ? value.every((entry) => isJson(entry, seen))
    : Object.values(value).every((entry) => isJson(entry, seen));
  seen.delete(value);
  return valid;
}

function validateEvidence(value: unknown, knownEvents: Set<string>, label: string): void {
  if (value === null) return;
  const evidence = record(value, label);
  string(evidence.value, `${label}.value`);
  if (!["observed", "source-stated", "user-supplied", "inferred"].includes(String(evidence.origin))) {
    throw new ThreadShiftError(`${label}.origin is invalid`, "INVALID_BUNDLE");
  }
  const eventIds = stringArray(evidence.eventIds, `${label}.eventIds`);
  if (eventIds.some((id) => !knownEvents.has(id)) && evidence.origin !== "user-supplied") {
    throw new ThreadShiftError(`${label} references a missing event`, "INVALID_BUNDLE");
  }
  if (evidence.observedAt !== undefined) string(evidence.observedAt, `${label}.observedAt`);
}

function validateWarning(value: unknown, knownEvents: Set<string>, label: string): Warning {
  const warning = record(value, label);
  string(warning.code, `${label}.code`);
  string(warning.message, `${label}.message`);
  const eventIds = stringArray(warning.eventIds, `${label}.eventIds`);
  if (eventIds.some((id) => !knownEvents.has(id))) throw new ThreadShiftError(`${label} references a missing event`, "INVALID_BUNDLE");
  return warning as unknown as Warning;
}

function validateHandoff(value: unknown, knownEvents: Set<string>): HandoffState {
  const handoff = record(value, "handoff");
  const scalarFields = ["objective", "latestRequest", "currentState"] as const;
  for (const field of scalarFields) validateEvidence(handoff[field], knownEvents, `handoff.${field}`);
  const listFields = ["completed", "decisions", "remaining", "blockers", "nextActions", "importantFiles", "verificationState", "activePlan"] as const;
  for (const field of listFields) {
    if (!Array.isArray(handoff[field])) throw new ThreadShiftError(`handoff.${field} must be an array`, "INVALID_BUNDLE");
    for (const [index, item] of (handoff[field] as unknown[]).entries()) validateEvidence(item, knownEvents, `handoff.${field}[${index}]`);
  }
  return handoff as unknown as HandoffState;
}

function validateEvent(value: unknown, index: number): Event {
  const event = record(value, `history.events[${index}]`);
  string(event.id, `history.events[${index}].id`);
  if (event.order !== index) throw new ThreadShiftError("Event order must be contiguous and chronological", "INVALID_BUNDLE");
  if (!["user", "assistant", "tool-call", "tool-result", "plan", "unknown"].includes(String(event.kind))) {
    throw new ThreadShiftError(`history.events[${index}].kind is unsupported`, "INVALID_BUNDLE");
  }
  if (event.text !== undefined && typeof event.text !== "string") throw new ThreadShiftError(`history.events[${index}].text must be a string`, "INVALID_BUNDLE");
  for (const field of ["timestamp", "sourceId"] as const) {
    if (event[field] !== undefined && typeof event[field] !== "string") throw new ThreadShiftError(`history.events[${index}].${field} must be a string`, "INVALID_BUNDLE");
  }
  if (event.callId !== undefined && typeof event.callId !== "string") throw new ThreadShiftError(`history.events[${index}].callId must be a string`, "INVALID_BUNDLE");
  stringArray(event.rawRecordIds, `history.events[${index}].rawRecordIds`);
  return event as unknown as Event;
}

export function validateBundle(input: unknown): ThreadShiftBundle {
  const bundle = record(input, "bundle");
  const manifest = record(bundle.manifest, "manifest");
  if (manifest.schemaVersion !== 1) throw new ThreadShiftError("Unsupported ThreadShift bundle schema version", "INVALID_BUNDLE");
  string(manifest.bundleId, "manifest.bundleId");
  assertSafeIdentifier(manifest.bundleId as string, "manifest.bundleId");
  string(manifest.capturedAt, "manifest.capturedAt");
  if (manifest.completeness !== "complete" && manifest.completeness !== "incomplete") throw new ThreadShiftError("manifest.completeness is invalid", "INVALID_BUNDLE");
  stringArray(manifest.exclusions, "manifest.exclusions");
  string(manifest.sourceDigest, "manifest.sourceDigest");
  string(manifest.workspaceDigest, "manifest.workspaceDigest");
  const counts = record(manifest.counts, "manifest.counts");
  const history = record(bundle.history, "history");
  if (!Array.isArray(history.events) || !Array.isArray(history.rawRecords)) throw new ThreadShiftError("history events and rawRecords must be arrays", "INVALID_BUNDLE");
  if (counts.events !== history.events.length || counts.rawRecords !== history.rawRecords.length) throw new ThreadShiftError("manifest counts do not match retained history", "INVALID_BUNDLE");
  const rawRecords = history.rawRecords.map((value, index) => {
    const raw = record(value, `history.rawRecords[${index}]`);
    string(raw.id, `history.rawRecords[${index}].id`);
    string(raw.sourceLocator, `history.rawRecords[${index}].sourceLocator`);
    if (!isJson(raw.value)) throw new ThreadShiftError(`history.rawRecords[${index}].value is not JSON`, "INVALID_BUNDLE");
    return raw as unknown as RawRecord;
  });
  const rawIds = new Set(rawRecords.map((raw) => raw.id));
  if (rawIds.size !== rawRecords.length) throw new ThreadShiftError("Raw record IDs must be unique", "INVALID_BUNDLE");
  const events = history.events.map(validateEvent);
  const eventIds = new Set(events.map((event) => event.id));
  if (eventIds.size !== events.length) throw new ThreadShiftError("Event IDs must be unique", "INVALID_BUNDLE");
  for (const event of events) {
    if (event.rawRecordIds.some((id) => !rawIds.has(id))) throw new ThreadShiftError(`Event ${event.id} references a missing raw record`, "INVALID_BUNDLE");
  }
  const calls = new Set(events.filter((event) => event.kind === "tool-call").map((event) => event.callId ?? event.id));
  if (events.some((event) => event.kind === "tool-result" && (!event.callId || !calls.has(event.callId)))) {
    throw new ThreadShiftError("Tool result references a missing tool call", "INVALID_BUNDLE");
  }
  const knownEvents = eventIds;
  if (!Array.isArray(bundle.warnings)) throw new ThreadShiftError("warnings must be an array", "INVALID_BUNDLE");
  const warnings = (bundle.warnings as unknown[]).map((warning, index) => validateWarning(warning, knownEvents, `warnings[${index}]`));
  const handoff = validateHandoff(bundle.handoff, knownEvents);
  const source = record(bundle.source, "source");
  if (source.harness !== "codex") throw new ThreadShiftError("source.harness is unsupported", "INVALID_BUNDLE");
  for (const key of ["runtimeVersion", "sessionId", "captureMechanism", "workingDirectory"]) string(source[key], `source.${key}`);
  assertSafeIdentifier(source.sessionId as string, "source.sessionId");
  const workspace = record(bundle.workspace, "workspace");
  for (const key of ["root", "inspectedAt", "digest"]) string(workspace[key], `workspace.${key}`);
  for (const key of ["instructionReferences", "artifactReferences"]) stringArray(workspace[key], `workspace.${key}`);
  if (!Array.isArray(workspace.changedFiles)) throw new ThreadShiftError("workspace.changedFiles must be an array", "INVALID_BUNDLE");
  for (const [index, value] of workspace.changedFiles.entries()) {
    const file = record(value, `workspace.changedFiles[${index}]`);
    string(file.path, `workspace.changedFiles[${index}].path`);
    string(file.status, `workspace.changedFiles[${index}].status`);
    if (typeof file.staged !== "boolean" || typeof file.unstaged !== "boolean") throw new ThreadShiftError(`workspace.changedFiles[${index}] flags must be boolean`, "INVALID_BUNDLE");
    if (file.digest !== undefined && typeof file.digest !== "string") throw new ThreadShiftError(`workspace.changedFiles[${index}].digest must be a string`, "INVALID_BUNDLE");
  }
  const git = record(bundle.git, "git");
  if (git.root !== undefined) string(git.root, "git.root");
  if (typeof git.present !== "boolean" || (git.head !== null && typeof git.head !== "string") || (git.branch !== null && typeof git.branch !== "string")) {
    throw new ThreadShiftError("git repository metadata is invalid", "INVALID_BUNDLE");
  }
  if (!Array.isArray(git.status) || !git.status.every((item) => isJson(item)) || !Array.isArray(git.patches) || !Array.isArray(git.warnings)) {
    throw new ThreadShiftError("git status, patches, and warnings must be arrays", "INVALID_BUNDLE");
  }
  for (const [index, value] of git.patches.entries()) {
    const patch = record(value, `git.patches[${index}]`);
    string(patch.path, `git.patches[${index}].path`);
    if (typeof patch.staged !== "boolean" || (patch.binary !== undefined && typeof patch.binary !== "boolean")) throw new ThreadShiftError(`git.patches[${index}] flags are invalid`, "INVALID_BUNDLE");
    if (patch.text !== undefined && typeof patch.text !== "string") throw new ThreadShiftError(`git.patches[${index}].text must be a string`, "INVALID_BUNDLE");
  }
  const gitWarnings = git.warnings as unknown[];
  gitWarnings.forEach((warning, index) => validateWarning(warning, knownEvents, `git.warnings[${index}]`));
  const configuration = record(bundle.configuration, "configuration");
  if (!Array.isArray(configuration.references) || !configuration.references.every((item) => isJson(item))) throw new ThreadShiftError("configuration.references must be JSON values", "INVALID_BUNDLE");
  string(configuration.compatibility, "configuration.compatibility");
  const artifacts = record(bundle.artifacts, "artifacts");
  if (!Array.isArray(artifacts.references) || !artifacts.references.every((item) => isJson(item))) throw new ThreadShiftError("artifacts.references must be JSON values", "INVALID_BUNDLE");
  if (!Array.isArray(bundle.provenance)) throw new ThreadShiftError("provenance must be an array", "INVALID_BUNDLE");
  for (const [index, value] of bundle.provenance.entries()) {
    const evidence = record(value, `provenance[${index}]`);
    if (!isJson(evidence.value)) throw new ThreadShiftError(`provenance[${index}].value is not JSON`, "INVALID_BUNDLE");
    if (!["observed", "source-stated", "user-supplied", "inferred"].includes(String(evidence.origin))) throw new ThreadShiftError(`provenance[${index}].origin is invalid`, "INVALID_BUNDLE");
    const refs = stringArray(evidence.eventIds, `provenance[${index}].eventIds`);
    if (refs.some((id) => !knownEvents.has(id))) throw new ThreadShiftError(`provenance[${index}] references a missing event`, "INVALID_BUNDLE");
  }
  return { ...bundle, manifest: manifest as unknown as ThreadShiftBundle["manifest"], history: { events, rawRecords }, source: source as unknown as ThreadShiftBundle["source"], workspace: workspace as unknown as ThreadShiftBundle["workspace"], git: git as unknown as ThreadShiftBundle["git"], handoff, configuration: configuration as unknown as ThreadShiftBundle["configuration"], artifacts: artifacts as unknown as ThreadShiftBundle["artifacts"], provenance: bundle.provenance as ThreadShiftBundle["provenance"], warnings } as ThreadShiftBundle;
}
