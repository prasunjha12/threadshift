import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, realpath } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { ThreadShiftError } from "../core/errors.js";
import { redactRecord } from "../core/redact.js";
import { isPrivatePath, loadPrivacyRules } from "../core/privacy-paths.js";
import type { GitSnapshot, JsonValue, Warning, WorkspaceSnapshot } from "../core/types.js";
import { runProcess, type ProcessResult } from "../runtime/process.js";

const PATCH_OUTPUT_LIMIT = 8 * 1024 * 1024;
const MAX_INSTRUCTION_PARENTS = 8;
const instructionNames = ["AGENTS.md", "CLAUDE.md", "CODEX.md", "opencode.json"];

interface StatusEntry {
  xy: string;
  path: string;
  originalPath?: string;
}

interface WorkspaceState {
  changedFiles: WorkspaceSnapshot["changedFiles"];
  instructionReferences: string[];
  git: GitSnapshot;
  digest: string;
}

function sha256(value: string | Buffer): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

async function digestFile(path: string): Promise<string | undefined> {
  try {
    const metadata = await lstat(path);
    if (!metadata.isFile() || metadata.isSymbolicLink()) return undefined;
    return await new Promise((resolveDigest, reject) => {
      const hash = createHash("sha256");
      const stream = createReadStream(path);
      stream.on("data", (chunk: string | Buffer) => { hash.update(chunk); });
      stream.on("error", reject);
      stream.on("end", () => resolveDigest(`sha256:${hash.digest("hex")}`));
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

async function git(cwd: string, args: string[], maxOutputBytes = 16 * 1024 * 1024): Promise<ProcessResult> {
  return runProcess({ executable: "git", args, cwd, timeoutMs: 15_000, maxOutputBytes });
}

function parseStatus(output: string): StatusEntry[] {
  const tokens = output.split("\0");
  const entries: StatusEntry[] = [];
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index];
    if (!token) continue;
    const xy = token.slice(0, 2);
    const path = token.slice(3);
    if (path.length === 0) throw new ThreadShiftError("Git returned a malformed status path", "WORKSPACE_CHANGED");
    const entry: StatusEntry = { xy, path };
    if (xy.includes("R") || xy.includes("C")) {
      const originalPath = tokens[++index];
      if (!originalPath) throw new ThreadShiftError("Git returned a rename without its original path", "WORKSPACE_CHANGED");
      entry.originalPath = originalPath;
    }
    entries.push(entry);
  }
  return entries;
}

async function findInstructions(root: string): Promise<string[]> {
  const found: string[] = [];
  let directory = root;
  for (let depth = 0; depth < MAX_INSTRUCTION_PARENTS; depth++) {
    for (const name of instructionNames) {
      const path = join(directory, name);
      try {
        const metadata = await lstat(path);
        if (metadata.isFile() && !metadata.isSymbolicLink()) found.push(path);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }
    const parent = dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }
  return found;
}

async function readPatches(root: string, entries: StatusEntry[], rules: string[]): Promise<{ patches: GitSnapshot["patches"]; warnings: Warning[] }> {
  const patches: GitSnapshot["patches"] = [];
  const warnings: Warning[] = [];
  for (const entry of entries) {
    if (isPrivatePath(entry.path, rules) || (entry.originalPath && isPrivatePath(entry.originalPath, rules))) {
      warnings.push({ code: "CONFIDENTIAL_FILE_EXCLUDED", message: "File content and hash were excluded by the privacy policy; change metadata remains.", eventIds: [] });
      continue;
    }
    for (const [staged, args] of [
      [true, ["diff", "--cached"]],
      [false, ["diff"]],
    ] as const) {
      if ((staged && entry.xy[0] === " " ) || (!staged && entry.xy[1] === " ")) continue;
      if (entry.xy === "??" || entry.xy === "!!") continue;
      let result: ProcessResult;
      try {
        result = await git(root, [...args, "--no-ext-diff", "--no-color", "--binary", "--unified=3", "--", entry.path], PATCH_OUTPUT_LIMIT);
      } catch (error) {
        if (error instanceof Error && "code" in error && error.code === "OUTPUT_LIMIT") {
          warnings.push({ code: "PATCH_OMITTED_SIZE", message: `A patch for '${entry.path}' exceeded the safe text limit and was omitted.`, eventIds: [] });
          continue;
        }
        throw error;
      }
      if (result.exitCode !== 0 || result.stdout.length === 0) continue;
      if (/^(?:Binary files .* differ|GIT binary patch)/m.test(result.stdout)) {
        patches.push({ path: entry.path, staged, binary: true });
        warnings.push({ code: "BINARY_PATCH_OMITTED", message: `Binary change '${entry.path}' is recorded without copying its contents.`, eventIds: [] });
        continue;
      }
      const redacted = redactRecord(result.stdout);
      patches.push({ path: entry.path, staged, text: redacted.value as string });
      warnings.push(...redacted.warnings);
    }
  }
  return { patches, warnings };
}

async function collectState(root: string): Promise<WorkspaceState> {
  const instructions = await findInstructions(root);
  const rootCheck = await git(root, ["rev-parse", "--show-toplevel"], 64 * 1024);
  if (rootCheck.exitCode !== 0) {
    if (!/not a git repository/i.test(rootCheck.stderr)) {
      throw new ThreadShiftError("Git could not determine whether the workspace is a repository", "WORKSPACE_CHANGED");
    }
    const gitSnapshot: GitSnapshot = { present: false, head: null, branch: null, status: [], patches: [], warnings: [] };
    const state = { changedFiles: [], instructionReferences: instructions, git: gitSnapshot };
    return { ...state, digest: sha256(JSON.stringify(state)) };
  }

  const repositoryRoot = await realpath(rootCheck.stdout.trim());
  const rules = await loadPrivacyRules(root, repositoryRoot);
  const headResult = await git(repositoryRoot, ["rev-parse", "--verify", "HEAD"], 64 * 1024);
  const branchResult = await git(root, ["symbolic-ref", "--quiet", "--short", "HEAD"], 64 * 1024);
  const statusResult = await git(root, ["status", "--renames", "--porcelain=v1", "-z", "--untracked-files=all"], 8 * 1024 * 1024);
  if (statusResult.exitCode !== 0) throw new ThreadShiftError("Git could not inspect the workspace status", "WORKSPACE_CHANGED");
  const entries = parseStatus(statusResult.stdout);
  const changes: WorkspaceSnapshot["changedFiles"] = [];
  for (const entry of entries) {
    const privateFile = isPrivatePath(entry.path, rules) || (entry.originalPath && isPrivatePath(entry.originalPath, rules));
    const digest = privateFile ? undefined : await digestFile(resolve(repositoryRoot, entry.path));
    changes.push({
      path: entry.path,
      status: entry.xy,
      staged: entry.xy[0] !== " " && entry.xy[0] !== "?",
      unstaged: entry.xy[1] !== " " && entry.xy[1] !== "?",
      ...(digest ? { digest } : {}),
    });
    if (entry.originalPath) changes.push({ path: entry.originalPath, status: "renamed-from", staged: entry.xy[0] !== " ", unstaged: false });
  }
  const { patches, warnings } = await readPatches(repositoryRoot, entries, rules);
  const gitSnapshot: GitSnapshot = {
    present: true,
    root: repositoryRoot,
    head: headResult.exitCode === 0 ? headResult.stdout.trim() : null,
    branch: branchResult.exitCode === 0 ? branchResult.stdout.trim() || null : null,
    status: entries.map((entry) => ({ ...entry }) as unknown as JsonValue),
    patches,
    warnings,
  };
  const state = { changedFiles: changes, instructionReferences: instructions, git: gitSnapshot };
  return { ...state, digest: sha256(JSON.stringify(state)) };
}

export async function inspectWorkspace(rootPath: string): Promise<WorkspaceSnapshot> {
  const root = await realpath(resolve(rootPath));
  const before = await collectState(root);
  const after = await collectState(root);
  if (before.digest !== after.digest) throw new ThreadShiftError("Workspace changed during inspection; retry the capture", "WORKSPACE_CHANGED");
  return {
    root,
    inspectedAt: new Date().toISOString(),
    digest: after.digest,
    changedFiles: after.changedFiles,
    instructionReferences: after.instructionReferences,
    artifactReferences: [],
    git: after.git,
    warnings: [...after.git.warnings],
  };
}
