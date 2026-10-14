import { createHash } from "node:crypto";
import { relative, sep } from "node:path";
import { ThreadShiftError } from "../core/errors.js";
import type { JsonValue, Warning, WorkspaceSnapshot } from "../core/types.js";

function digestState(changedFiles: WorkspaceSnapshot["changedFiles"], instructionReferences: string[], git: WorkspaceSnapshot["git"]): string {
  return `sha256:${createHash("sha256").update(JSON.stringify({ changedFiles, instructionReferences, git })).digest("hex")}`;
}

export function excludeGeneratedOutput(snapshot: WorkspaceSnapshot, outputDirectory: string): WorkspaceSnapshot {
  const relativeOutput = relative(snapshot.git.root ?? snapshot.root, outputDirectory).split(sep).join("/").replace(/\/$/, "");
  if (!relativeOutput || relativeOutput === ".." || relativeOutput.startsWith("../")) return snapshot;
  const contains = (path: string): boolean => path === relativeOutput || path.startsWith(`${relativeOutput}/`);
  const changedFiles = snapshot.changedFiles.filter((file) => !contains(file.path));
  const status = snapshot.git.status.filter((entry) => {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) return true;
    const value = entry as Record<string, JsonValue>;
    return typeof value.path !== "string" || !contains(value.path);
  });
  const patches = snapshot.git.patches.filter((patch) => !contains(patch.path));
  const git = { ...snapshot.git, status, patches };
  return {
    ...snapshot,
    changedFiles,
    git,
    digest: digestState(changedFiles, snapshot.instructionReferences, git),
  };
}

export function compareWorkspace(
  expected: Pick<WorkspaceSnapshot, "root" | "digest">,
  current: Pick<WorkspaceSnapshot, "root" | "digest">,
  acceptMismatch = false,
): Warning[] {
  const mismatches: string[] = [];
  if (expected.root !== current.root) mismatches.push("workspace path");
  if (expected.digest !== current.digest) mismatches.push("workspace snapshot");
  if (mismatches.length === 0) return [];
  const message = `The current ${mismatches.join(" and ")} differs from the captured handoff; old verification may be stale.`;
  if (!acceptMismatch) throw new ThreadShiftError(`${message} Review it and pass --accept-workspace-mismatch to continue.`, "WORKSPACE_MISMATCH");
  return [{ code: "WORKSPACE_MISMATCH_ACCEPTED", message, eventIds: [] }];
}
