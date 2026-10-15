import { createHash } from "node:crypto";
import type { CaptureResult, JsonValue, ThreadShiftBundle } from "./types.js";
import { validateBundle } from "./validate.js";
import { redactRecord } from "./redact.js";
import { isPrivatePath, referencesPrivatePath } from "./privacy-paths.js";

const omitted = "[EXCLUDED: confidential file content]";
function pick<T>(value: T, keys: string[]): T {
  const input = value as Record<string, unknown>;
  return Object.fromEntries(keys.filter((key) => Object.hasOwn(input, key)).map((key) => [key, input[key]])) as T;
}
function hash(value: unknown): string {
  return `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
}
function references(value: unknown, rules: string[]): boolean {
  if (typeof value === "string") return referencesPrivatePath(value, rules);
  if (Array.isArray(value)) return value.some((entry) => references(entry, rules));
  return value !== null && typeof value === "object" && Object.entries(value).some(([key, entry]) =>
    (/^(?:path|file|filename|filepath|uri)$/i.test(key) && typeof entry === "string" && isPrivatePath(entry, rules)) || references(entry, rules));
}

/** Apply the canonical privacy boundary before a source adapter returns readable history. */
export function sanitizeCapture(capture: CaptureResult): CaptureResult {
  const safe = sanitizeBundle({
    manifest: { schemaVersion: capture.source.harness === "codex" ? 1 : capture.source.harness === "pi" ? 3 : 2, bundleId: "capture", capturedAt: new Date(0).toISOString(), completeness: capture.completeness, counts: { events: capture.events.length, rawRecords: capture.rawRecords.length }, sourceDigest: capture.sourceDigest, workspaceDigest: "uninspected", exclusions: capture.exclusions },
    source: capture.source, history: { events: capture.events, rawRecords: capture.rawRecords },
    workspace: { root: capture.source.workingDirectory, inspectedAt: new Date(0).toISOString(), digest: "uninspected", changedFiles: [], instructionReferences: [], artifactReferences: [] },
    git: { present: false, head: null, branch: null, status: [], patches: [], warnings: [] },
    handoff: { objective: null, latestRequest: null, currentState: null, completed: [], decisions: [], remaining: [], blockers: [], nextActions: [], importantFiles: [], verificationState: [], activePlan: [] },
    configuration: { references: [], compatibility: "not-translated" }, artifacts: { references: [] }, provenance: [], warnings: capture.warnings,
  });
  return { ...capture, source: safe.source, events: safe.history.events, rawRecords: safe.history.rawRecords, warnings: safe.warnings, sourceDigest: safe.manifest.sourceDigest, exclusions: safe.manifest.exclusions };
}

/** Schema projection and confidentiality processing are repeated at outbound boundaries. */
export function sanitizeBundle(input: unknown, rules: string[] = []): ThreadShiftBundle {
  const original = validateBundle(input);
  const warning = (value: ThreadShiftBundle["warnings"][number]) => pick(value, ["code", "message", "eventIds"]);
  const evidence = <T extends { value: unknown; eventIds: string[] }>(value: T | null): T | null => value === null ? null : pick(value, ["value", "origin", "eventIds", "observedAt"]);
  const handoff = { ...original.handoff };
  for (const key of ["objective", "latestRequest", "currentState"] as const) handoff[key] = evidence(handoff[key]);
  for (const key of ["completed", "decisions", "remaining", "blockers", "nextActions", "importantFiles", "verificationState", "activePlan"] as const) handoff[key] = handoff[key].map((entry) => evidence(entry)!);
  const bundle: ThreadShiftBundle = {
    manifest: { ...pick(original.manifest, ["schemaVersion", "bundleId", "capturedAt", "completeness", "counts", "sourceDigest", "workspaceDigest", "exclusions"]), counts: pick(original.manifest.counts, ["events", "rawRecords"]) },
    source: { ...pick(original.source, ["harness", "runtimeVersion", "sessionId", "captureMechanism", "workingDirectory"]), ...(original.source.selection ? { selection: pick(original.source.selection, ["kind", "leafId", "totalEntries", "selectedEntries", "excludedEntries"]) } : {}) },
    history: {
      events: original.history.events.map((entry) => pick(entry, ["id", "order", "kind", "sourceId", "timestamp", "text", "callId", "rawRecordIds"])),
      rawRecords: original.history.rawRecords.map((entry) => ({ ...pick(entry, ["id", "sourceLocator", "value"]), value: structuredClone(entry.value) })),
    },
    workspace: { ...pick(original.workspace, ["root", "inspectedAt", "digest", "changedFiles", "instructionReferences", "artifactReferences"]), changedFiles: original.workspace.changedFiles.map((entry) => pick(entry, ["path", "status", "staged", "unstaged", "digest"])) },
    git: { ...pick(original.git, ["present", "root", "head", "branch", "status", "patches", "warnings"]),
      status: original.git.status.map((entry) => typeof entry === "object" && entry !== null && !Array.isArray(entry) ? pick(entry, ["xy", "path", "originalPath"]) : entry),
      patches: original.git.patches.map((entry) => pick(entry, ["path", "staged", "text", "binary"])), warnings: original.git.warnings.map(warning) },
    handoff: pick(handoff, ["objective", "latestRequest", "currentState", "completed", "decisions", "remaining", "blockers", "nextActions", "importantFiles", "verificationState", "activePlan"]),
    configuration: pick(original.configuration, ["references", "compatibility"]),
    artifacts: pick(original.artifacts, ["references"]),
    provenance: original.provenance.map((entry) => evidence(entry)!),
    warnings: original.warnings.map(warning),
  };
  const exclusions = new Set(bundle.manifest.exclusions);
  const excludedRaw = new Set<string>();
  const privateStrings = new Set<string>();
  const remember = (value: JsonValue): void => {
    if (typeof value === "string" && value && !value.startsWith("[EXCLUDED:")) privateStrings.add(value);
    else if (Array.isArray(value)) value.forEach(remember);
    else if (value && typeof value === "object") Object.values(value).forEach(remember);
  };
  for (const raw of bundle.history.rawRecords) {
    const value = raw.value;
    const scrubReasoning = (entry: JsonValue): void => {
      if (Array.isArray(entry)) { entry.forEach(scrubReasoning); return; }
      if (typeof entry !== "object" || entry === null) return;
      if (bundle.source.harness === "pi") {
        const strip = (key: string, label: string): void => { if (Object.hasOwn(entry, key)) { remember(entry[key]!); entry[key] = label; exclusions.add("pi.private-content"); } };
        for (const key of ["thinkingSignature", "textSignature", "thoughtSignature", "providerState", "providerResultState", "providerContext"]) strip(key, "[EXCLUDED: provider-private state]");
        if (entry.type === "thinking") for (const key of ["thinking", "text", "signature"]) strip(key, "[EXCLUDED: non-user-visible reasoning]");
        if (entry.type === "image") strip("data", "[EXCLUDED: media content]");
        if (entry.type === "custom") strip("data", "[EXCLUDED: opaque custom state]");
        if (entry.role === "system") for (const key of ["content", "sections", "tools"]) strip(key, "[EXCLUDED: source system configuration]");
        if (entry.type === "custom_message") strip("details", "[EXCLUDED: opaque custom metadata]");
      }
      if (entry.type === "reasoning") {
        excludedRaw.add(raw.id);
        for (const field of ["content", "summary", "text", "state", "providerState", "providerResultState", "providerContext"]) if (Object.hasOwn(entry, field)) {
          entry[field] = `[EXCLUDED: non-user-visible reasoning ${field}]`;
          exclusions.add(`reasoning.${field}`);
          excludedRaw.add(raw.id);
        }
        if (entry.time && typeof entry.time === "object" && !Array.isArray(entry.time)) {
          const time = entry.time;
          entry.time = Object.fromEntries(Object.entries(time).filter(([key, value]) => ["created", "completed"].includes(key) && typeof value === "number"));
        } else if (Object.hasOwn(entry, "time")) delete entry.time;
      }
      if (Array.isArray(entry.files)) for (const file of entry.files) {
        if (file && typeof file === "object" && !Array.isArray(file) && Object.hasOwn(file, "data")) {
          file.data = "[EXCLUDED: media content]";
          exclusions.add("media.content"); excludedRaw.add(raw.id);
        }
      }
      if (bundle.source.harness === "opencode") {
        if (entry.type === "text" && Object.hasOwn(entry, "state")) {
          entry.state = "[EXCLUDED: provider-private state]";
          exclusions.add("provider-state"); excludedRaw.add(raw.id);
        }
        for (const field of ["providerState", "providerResultState", "providerContext"]) if (Object.hasOwn(entry, field)) {
          entry[field] = "[EXCLUDED: provider-private state]";
          exclusions.add("provider-state");
          excludedRaw.add(raw.id);
        }
      }
      Object.values(entry).forEach(scrubReasoning);
    };
    scrubReasoning(value);
    if (typeof value === "object" && value !== null && !Array.isArray(value)) {
      if (references(value, rules)) {
        raw.value = { ...(typeof value.id === "string" ? { id: value.id } : {}), ...(typeof value.type === "string" ? { type: value.type } : {}), excluded: omitted };
        excludedRaw.add(raw.id);
      }
    } else if (references(value, rules)) { raw.value = omitted; excludedRaw.add(raw.id); }
  }
  const excludedEvents = new Set<string>();
  const rawById = new Map(bundle.history.rawRecords.map(raw => [raw.id, raw]));
  for (const event of bundle.history.events) {
    if (event.rawRecordIds.some((id) => excludedRaw.has(id)) || (event.text && referencesPrivatePath(event.text, rules))) {
      const visibleTextIsSafe = bundle.source.harness === "opencode" && typeof event.text === "string" && !referencesPrivatePath(event.text, rules) && event.rawRecordIds.length > 0 && event.rawRecordIds.every(id => {
        const value = rawById.get(id)?.value;
        return value && typeof value === "object" && !Array.isArray(value) && ["text", "user"].includes(String(value.type)) && value.text === event.text;
      });
      if (!visibleTextIsSafe) event.text = omitted;
      excludedEvents.add(event.id);
    }
  }
  for (const value of [bundle.handoff.objective, bundle.handoff.latestRequest, bundle.handoff.currentState, ...bundle.handoff.completed, ...bundle.handoff.decisions, ...bundle.handoff.remaining, ...bundle.handoff.blockers, ...bundle.handoff.nextActions, ...bundle.handoff.importantFiles, ...bundle.handoff.verificationState, ...bundle.handoff.activePlan, ...bundle.provenance]) {
    if (value && (value.eventIds.some((id) => excludedEvents.has(id)) || references(value.value, rules))) value.value = omitted;
  }
  const renamedSensitive = new Set<string>();
  for (const entry of bundle.git.status) {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) continue;
    if (typeof entry.path === "string" && (isPrivatePath(entry.path, rules) || (typeof entry.originalPath === "string" && isPrivatePath(entry.originalPath, rules)))) renamedSensitive.add(entry.path);
  }
  const oldPatchCount = bundle.git.patches.length;
  bundle.git.patches = bundle.git.patches.filter((patch) => {
    const header = (patch.text ?? "").split(/\r?\n/).filter((line) => /^(?:diff --git |--- |\+\+\+ |rename (?:from|to) |copy (?:from|to) )/.test(line)).join("\n");
    return !isPrivatePath(patch.path, rules) && !renamedSensitive.has(patch.path) && !referencesPrivatePath(header, rules);
  });
  for (const file of bundle.workspace.changedFiles) if (isPrivatePath(file.path, rules) || renamedSensitive.has(file.path)) delete file.digest;
  bundle.configuration.references = bundle.configuration.references.map((entry) => references(entry, rules) ? omitted : entry);
  bundle.artifacts.references = bundle.artifacts.references.map((entry) => references(entry, rules) ? omitted : entry);
  for (const item of [...bundle.warnings, ...bundle.git.warnings]) if (item.eventIds.some((id) => excludedEvents.has(id)) || referencesPrivatePath(item.message, rules)) item.message = omitted;
  if (excludedRaw.size || excludedEvents.size || oldPatchCount !== bundle.git.patches.length) {
    exclusions.add("confidential-file-content");
    if (!bundle.warnings.some((entry) => entry.code === "CONFIDENTIAL_CONTENT_EXCLUDED")) bundle.warnings.push({ code: "CONFIDENTIAL_CONTENT_EXCLUDED", message: "Confidential-file content was excluded from history and patches; metadata may remain.", eventIds: [] });
  }
  if (exclusions.has("media.content") && !bundle.warnings.some(entry => entry.code === "MEDIA_CONTENT_EXCLUDED")) bundle.warnings.push({ code: "MEDIA_CONTENT_EXCLUDED", message: "Inline attachment content was excluded; safe reference metadata may remain.", eventIds: [] });
  bundle.manifest.exclusions = [...exclusions];
  // Remove recognized private fragments from every linked or duplicated copy, including warnings.
  const removeCopies = (value: JsonValue): JsonValue => {
    if (typeof value === "string") { for (const fragment of privateStrings) if (value.includes(fragment)) value = value.split(fragment).join("[EXCLUDED: private content]"); return value; }
    if (Array.isArray(value)) return value.map(removeCopies);
    if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, removeCopies(item)]));
    return value;
  };
  const redacted = redactRecord(removeCopies(bundle as unknown as JsonValue));
  const safe = validateBundle(redacted.value);
  for (const item of redacted.warnings) if (!safe.warnings.some((entry) => entry.code === item.code && entry.message === item.message)) safe.warnings.push(item);
  for (const item of [...safe.warnings, ...safe.git.warnings]) if (referencesPrivatePath(item.message, rules)) item.message = omitted;
  safe.manifest.sourceDigest = hash(safe.source.harness === "pi" ? { selection: safe.source.selection, rawRecords: safe.history.rawRecords } : safe.history.rawRecords);
  safe.workspace.digest = hash({ changedFiles: safe.workspace.changedFiles, instructionReferences: safe.workspace.instructionReferences, git: safe.git });
  safe.manifest.workspaceDigest = safe.workspace.digest;
  return validateBundle(safe);
}
