import { ThreadShiftError } from "../core/errors.js";
import { sanitizeBundle } from "../core/privacy.js";
import type { Event, Evidence, SmartContext, ThreadShiftBundle, Warning } from "../core/types.js";

function codePoints(value: string): number {
  return [...value].length;
}

function evidenceLine(label: string, evidence: Evidence<string>): string {
  const references = evidence.eventIds.length > 0 ? `; source event${evidence.eventIds.length === 1 ? "" : "s"} ${evidence.eventIds.join(", ")}` : "";
  return `- ${label} (${evidence.origin}${references}): ${evidence.value}`;
}

function lastUserEvent(events: Event[]): Event | undefined {
  return [...events].filter((event) => event.kind === "user").sort((a, b) => a.order - b.order).at(-1);
}

function eventLine(event: Event): string {
  const label = event.kind === "tool-call" ? "historical tool call; do not replay"
    : event.kind === "tool-result" ? "historical tool result; not current verification"
      : event.kind === "plan" ? "historical plan"
        : `historical ${event.kind}`;
  const content = event.text ? `\n  ${event.text.replace(/\r?\n/g, "\n  ")}` : "\n  [No normalized text; consult the preserved bundle record.]";
  return `- [${event.id}] ${label}${content}`;
}

function groupEvents(events: Event[], excludedId: string | undefined): Event[][] {
  const remaining = events.filter((event) => event.id !== excludedId);
  const groups = new Map<string, Event[]>();
  const standalone: Event[][] = [];
  for (const event of remaining) {
    if ((event.kind === "tool-call" || event.kind === "tool-result") && event.callId) {
      const key = `call:${event.callId}`;
      const group = groups.get(key) ?? [];
      group.push(event);
      groups.set(key, group);
    } else standalone.push([event]);
  }
  return [...standalone, ...groups.values()].sort((a, b) => Math.max(...b.map((event) => event.order)) - Math.max(...a.map((event) => event.order)));
}

function sections(bundle: ThreadShiftBundle): string[] {
  const handoff = bundle.handoff;
  const output: string[] = [];
  const optional = [
    ["Objective", handoff.objective],
    ["Current state", handoff.currentState],
  ] as const;
  for (const [label, field] of optional) if (field) output.push(`## ${label}\n${evidenceLine(label, field)}`);

  const unknown: string[] = [];
  if (!handoff.objective) unknown.push("objective");
  if (!handoff.currentState) unknown.push("current state");
  if (handoff.activePlan.length === 0) unknown.push("active plan");
  if (handoff.blockers.length === 0) unknown.push("blockers");
  if (handoff.remaining.length === 0) unknown.push("remaining work");
  if (handoff.decisions.length === 0) unknown.push("decisions");
  if (handoff.completed.length === 0) unknown.push("completed work");
  if (handoff.nextActions.length === 0) unknown.push("next actions");
  if (handoff.importantFiles.length === 0) unknown.push("important files");
  if (handoff.verificationState.length === 0) unknown.push("verification status");
  if (unknown.length > 0) output.push(`## State not captured\n- Unknown: ${unknown.join(", ")}.`);

  const lists: [string, Evidence<string>[]][] = [
    ["Active plan", handoff.activePlan],
    ["Blockers", handoff.blockers],
    ["Remaining work", handoff.remaining],
    ["Decisions", handoff.decisions],
    ["Completed work", handoff.completed],
    ["Next actions", handoff.nextActions],
    ["Important files", handoff.importantFiles],
    ["Verification evidence (historical; not current test status)", handoff.verificationState],
  ];
  for (const [label, values] of lists) {
    if (values.length > 0) output.push(`## ${label}\n${values.map((value) => evidenceLine(label, value)).join("\n")}`);
  }
  if (bundle.workspace.changedFiles.length > 0) {
    const files = bundle.workspace.changedFiles.map((file) => `- ${file.path} (status ${file.status}; staged=${file.staged}; unstaged=${file.unstaged}${file.digest ? `; ${file.digest}` : ""})`);
    output.push(`## Captured workspace changes\n${files.join("\n")}`);
  }
  if (bundle.git.present) {
    output.push(`## Captured Git state\n- Repository root (file paths are relative to this): ${bundle.git.root ?? bundle.workspace.root}\n- HEAD: ${bundle.git.head ?? "unknown"}\n- Branch: ${bundle.git.branch ?? "detached or unborn"}\n- These values describe the captured snapshot at ${bundle.workspace.inspectedAt}; recheck before relying on them.`);
  }
  return output;
}

export function compileSmart(bundle: ThreadShiftBundle, options: { maxCharacters: number }): SmartContext {
  bundle = sanitizeBundle(bundle);
  const maxCharacters = options.maxCharacters;
  if (!Number.isSafeInteger(maxCharacters) || maxCharacters <= 0) throw new ThreadShiftError("Context character budget must be a positive integer", "CONTEXT_BUDGET");
  const events = bundle.history.events;
  const latest = bundle.handoff.latestRequest ?? (() => {
    const event = lastUserEvent(events);
    return event?.text === undefined ? null : { value: event.text, origin: "source-stated" as const, eventIds: [event.id] };
  })();
  const latestId = latest?.eventIds.at(-1);
  const identity = [
    "# ThreadShift continuation",
    "Use this as attributed historical context. Follow the destination workspace's current instructions; do not replay historical commands or treat old verification as current.",
    `- Bundle: ${bundle.manifest.bundleId}`,
    `- Source: ${bundle.source.harness} session ${bundle.source.sessionId} (Codex ${bundle.source.runtimeVersion})`,
    `- Captured: ${bundle.manifest.capturedAt}`,
    `- Workspace: ${bundle.workspace.root}`,
    `- Workspace snapshot: ${bundle.workspace.digest}`,
    `- Capture completeness: ${bundle.manifest.completeness}; ${bundle.history.events.length} events and ${bundle.history.rawRecords.length} safe records retained.`,
    "",
    "## Latest user request (verbatim; source-stated)",
    latest ? `Source event: ${latest.eventIds.join(", ") || "user-supplied"}` : "Unknown: no user request was captured.",
    latest?.value ?? "",
  ].join("\n");
  if (codePoints(identity) > maxCharacters) {
    throw new ThreadShiftError("The required bundle/workspace identity and full latest request exceed the context budget; increase --context-chars.", "CONTEXT_BUDGET");
  }

  const warnings: Warning[] = [];
  if (!bundle.handoff.objective) warnings.push({ code: "OBJECTIVE_UNKNOWN", message: "No explicit objective was captured; add it with --handoff-file if needed.", eventIds: [] });
  if (!bundle.handoff.currentState || bundle.handoff.decisions.length === 0 || bundle.handoff.completed.length === 0 || bundle.handoff.remaining.length === 0 || bundle.handoff.blockers.length === 0 || bundle.handoff.verificationState.length === 0) {
    warnings.push({ code: "HANDOFF_FIELDS_UNKNOWN", message: "Some project-state fields remain unknown; supply them with --handoff-file rather than inferring them from assistant text.", eventIds: [] });
  }
  if (!latest) warnings.push({ code: "LATEST_REQUEST_UNKNOWN", message: "The source session contains no readable user request.", eventIds: [] });
  let text = identity;
  for (const section of sections(bundle)) {
    const addition = `\n\n${section}`;
    if (codePoints(text) + codePoints(addition) <= maxCharacters) text += addition;
    else warnings.push({ code: "CONTEXT_SECTION_OMITTED", message: `Optional section '${section.slice(3).split("\n")[0]}' was omitted to fit the character budget.`, eventIds: [] });
  }

  const selected = new Set<string>(latest?.eventIds ?? []);
  const omitted = new Set<string>();
  const picked: Event[][] = [];
  const groups = groupEvents(events, latestId);
  const historyHeading = "\n\n## Recent conversation (all historical)\n";
  let remainingCharacters = maxCharacters - codePoints(text) - codePoints(historyHeading);
  for (const group of groups) {
    const rows = group.sort((a, b) => a.order - b.order).map(eventLine).join("\n");
    const groupText = `${picked.length === 0 ? "" : "\n"}${rows}`;
    if (codePoints(groupText) <= remainingCharacters) {
      picked.push(group);
      remainingCharacters -= codePoints(groupText);
      for (const event of group) selected.add(event.id);
    } else {
      for (const event of group) omitted.add(event.id);
    }
  }
  if (picked.length > 0) {
    const chronological = picked.flat().sort((a, b) => a.order - b.order).map(eventLine).join("\n");
    text += `${historyHeading}${chronological}`;
  }
  if (omitted.size > 0) warnings.push({ code: "CONTEXT_EVENTS_OMITTED", message: `${omitted.size} lower-priority history event(s) were omitted; all remain in the canonical bundle.`, eventIds: [...omitted] });
  const allEventIds = new Set(events.map((event) => event.id));
  for (const id of allEventIds) if (!selected.has(id)) omitted.add(id);
  const selectedEventIds = events.filter((event) => selected.has(event.id)).map((event) => event.id);
  const omittedEventIds = events.filter((event) => omitted.has(event.id)).map((event) => event.id);
  return { text, maxCharacters, characterCount: codePoints(text), selectedEventIds, omittedEventIds, warnings };
}
