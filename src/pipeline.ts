import { randomUUID } from "node:crypto";
import { stat } from "node:fs/promises";
import type { CaptureResult, ConversionReport, Evidence, HandoffState, Harness, ThreadShiftBundle, Warning, WorkspaceSnapshot } from "./core/types.js";
import { ThreadShiftError } from "./core/errors.js";
import { sanitizeBundle } from "./core/privacy.js";
import { loadPrivacyRules } from "./core/privacy-paths.js";
import { captureCodex } from "./adapters/codex/capture.js";
import { deriveHandoff, sanitizeHandoffFields } from "./context/handoff.js";
import { inspectWorkspace } from "./workspace/inspect.js";

export function createBundle(
  capture: CaptureResult,
  workspace: WorkspaceSnapshot,
  handoff: HandoffState,
  capturedAt = new Date().toISOString(),
): ThreadShiftBundle {
  const warnings: Warning[] = [...capture.warnings, ...workspace.warnings];
  if (!handoff.objective) warnings.push({ code: "OBJECTIVE_UNKNOWN", message: "No explicit objective was captured; supply it through --handoff-file if needed.", eventIds: [] });
  const evidence: Evidence<string>[] = [];
  for (const value of [handoff.objective, handoff.latestRequest, handoff.currentState, ...handoff.completed, ...handoff.decisions, ...handoff.remaining, ...handoff.blockers, ...handoff.nextActions, ...handoff.importantFiles, ...handoff.verificationState, ...handoff.activePlan]) {
    if (value) evidence.push(value);
  }
  const bundle: ThreadShiftBundle = {
    manifest: {
      schemaVersion: capture.source.harness === "codex" ? 1 : 2,
      bundleId: randomUUID(),
      capturedAt,
      completeness: capture.completeness,
      counts: { events: capture.events.length, rawRecords: capture.rawRecords.length },
      sourceDigest: capture.sourceDigest,
      workspaceDigest: workspace.digest,
      exclusions: capture.exclusions,
    },
    source: capture.source,
    history: { events: capture.events, rawRecords: capture.rawRecords },
    workspace: {
      root: workspace.root,
      inspectedAt: workspace.inspectedAt,
      digest: workspace.digest,
      changedFiles: workspace.changedFiles,
      instructionReferences: workspace.instructionReferences,
      artifactReferences: workspace.artifactReferences,
    },
    git: workspace.git,
    handoff,
    configuration: { references: [], compatibility: "not-translated" },
    artifacts: { references: [] },
    provenance: evidence.map((value) => ({ value: value.value, origin: value.origin, eventIds: value.eventIds, ...(value.observedAt ? { observedAt: value.observedAt } : {}) })),
    warnings,
  };
  return sanitizeBundle(bundle);
}

export async function captureBundle(options: {
  sessionId: string;
  workspaceRoot: string;
  codexBin?: string;
  codexHome?: string;
  handoffFields?: unknown;
}, signal?: AbortSignal): Promise<{ bundle: ThreadShiftBundle; workspace: WorkspaceSnapshot }> {
  const captureOptions = {
    sessionId: options.sessionId,
    ...(options.codexBin ? { executable: options.codexBin } : {}),
    ...(options.codexHome ? { codexHome: options.codexHome } : {}),
    cwd: options.workspaceRoot,
  };
  const capture = await captureCodex(captureOptions, signal);
  const workspace = await inspectWorkspace(options.workspaceRoot);
  const sanitized = sanitizeHandoffFields(options.handoffFields);
  const handoff = deriveHandoff(capture, workspace, sanitized.fields);
  const rules = await loadPrivacyRules(workspace.root, workspace.git.root ?? workspace.root);
  return { bundle: sanitizeBundle(createBundle({ ...capture, warnings: [...capture.warnings, ...sanitized.warnings] }, workspace, handoff), rules), workspace };
}

export async function loadBundle(path: string): Promise<ThreadShiftBundle> {
  const metadata = await stat(path);
  if (!metadata.isFile() || metadata.size > 64 * 1024 * 1024) throw new ThreadShiftError("Bundle must be a file no larger than 64 MiB", "INVALID_BUNDLE");
  const { readFile } = await import("node:fs/promises");
  let input: unknown;
  try {
    input = JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    throw new ThreadShiftError("Bundle is not valid JSON", "INVALID_BUNDLE", { cause: error });
  }
  return sanitizeBundle(input);
}

export function createReport(
  bundle: ThreadShiftBundle,
  context: { selectedEventIds: string[]; warnings: Warning[] },
  destinationVersion: string,
  options: { preparation: ConversionReport["preparation"]; warnings?: Warning[]; destination?: Harness } ,
): ConversionReport {
  return {
    source: { harness: bundle.source.harness, sessionId: bundle.source.sessionId, runtimeVersion: bundle.source.runtimeVersion },
    destination: { harness: options.destination ?? "opencode", runtimeVersion: destinationVersion },
    mode: "smart",
    completeness: bundle.manifest.completeness,
    preservedCounts: { events: bundle.history.events.length, rawRecords: bundle.history.rawRecords.length },
    selectedCounts: { events: context.selectedEventIds.length },
    workspaceDigest: bundle.workspace.digest,
    warnings: [...bundle.warnings, ...context.warnings, ...(options.warnings ?? [])],
    preparation: options.preparation,
  };
}
