export type JsonPrimitive = string | number | boolean | null;
export type Harness = "codex" | "opencode";
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type EvidenceOrigin = "observed" | "source-stated" | "user-supplied" | "inferred";

export interface Evidence<T> {
  value: T;
  origin: EvidenceOrigin;
  eventIds: string[];
  observedAt?: string;
}

export interface Event {
  id: string;
  order: number;
  kind: "user" | "assistant" | "tool-call" | "tool-result" | "plan" | "unknown";
  sourceId?: string;
  timestamp?: string;
  text?: string;
  callId?: string;
  rawRecordIds: string[];
}

export interface RawRecord {
  id: string;
  value: JsonValue;
  sourceLocator: string;
}

export interface Warning {
  code: string;
  message: string;
  eventIds: string[];
}

export interface HandoffState {
  objective: Evidence<string> | null;
  latestRequest: Evidence<string> | null;
  currentState: Evidence<string> | null;
  completed: Evidence<string>[];
  decisions: Evidence<string>[];
  remaining: Evidence<string>[];
  blockers: Evidence<string>[];
  nextActions: Evidence<string>[];
  importantFiles: Evidence<string>[];
  verificationState: Evidence<string>[];
  activePlan: Evidence<string>[];
}

export interface GitSnapshot {
  present: boolean;
  root?: string;
  head: string | null;
  branch: string | null;
  status: JsonValue[];
  patches: { path: string; staged: boolean; text?: string; binary?: boolean }[];
  warnings: Warning[];
}

export interface WorkspaceFileChange {
  path: string;
  status: string;
  staged: boolean;
  unstaged: boolean;
  digest?: string;
}

export interface WorkspaceSnapshot {
  root: string;
  inspectedAt: string;
  digest: string;
  changedFiles: WorkspaceFileChange[];
  instructionReferences: string[];
  artifactReferences: string[];
  git: GitSnapshot;
  warnings: Warning[];
}

export interface ThreadShiftBundle {
  manifest: {
    schemaVersion: 1 | 2;
    bundleId: string;
    capturedAt: string;
    completeness: "complete" | "incomplete";
    counts: { events: number; rawRecords: number };
    sourceDigest: string;
    workspaceDigest: string;
    exclusions: string[];
  };
  source: {
    harness: Harness;
    runtimeVersion: string;
    sessionId: string;
    captureMechanism: string;
    workingDirectory: string;
  };
  history: { events: Event[]; rawRecords: RawRecord[] };
  workspace: Omit<WorkspaceSnapshot, "git" | "warnings">;
  git: GitSnapshot;
  handoff: HandoffState;
  configuration: { references: JsonValue[]; compatibility: string };
  artifacts: { references: JsonValue[] };
  provenance: Evidence<JsonValue>[];
  warnings: Warning[];
}

export interface CaptureResult {
  source: ThreadShiftBundle["source"];
  events: Event[];
  rawRecords: RawRecord[];
  warnings: Warning[];
  sourceDigest: string;
  completeness: "complete" | "incomplete";
  exclusions: string[];
}

export interface SmartContext {
  maxCharacters?: number;
  text: string;
  characterCount: number;
  selectedEventIds: string[];
  omittedEventIds: string[];
  warnings: Warning[];
}

export interface ConversionReport {
  source: { harness: string; sessionId: string; runtimeVersion: string };
  destination: { harness: Harness; runtimeVersion: string };
  mode: "smart";
  completeness: "complete" | "incomplete";
  preservedCounts: { events: number; rawRecords: number };
  selectedCounts: { events: number };
  workspaceDigest: string;
  warnings: Warning[];
  preparation: "prepared" | "failed" | "dry-run";
  outputPaths?: { bundle: string; context: string; report: string };
  launchInstructions?: { executable: string; args: string[]; cwd: string };
  launch?: { status: "launched" | "failed"; sessionId?: string; exitCode: number | null };
}

export interface PreparedHandoff {
  bundlePath: string;
  contextPath: string;
  reportPath: string;
  workspaceRoot: string;
  launch: ProcessSpec;
}

export interface ProcessSpec {
  executable: string;
  args: string[];
  cwd: string;
  env?: Record<string, string>;
  timeoutMs: number;
  maxOutputBytes?: number;
}

export interface ProcessResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
}

export interface HarnessDescriptor {
  executable: string;
  argsPrefix: string[];
  wrapperPath?: string;
  version?: string;
}
