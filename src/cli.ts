#!/usr/bin/env node
import { homedir } from "node:os";
import { isAbsolute, relative, resolve, sep, join } from "node:path";
import { readFile, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { ThreadShiftError } from "./core/errors.js";
import { assertDefaultOutputContained, assertSafePackageOutput, writeBundle } from "./core/files.js";
import { sanitizeBundle } from "./core/privacy.js";
import { loadPrivacyRules } from "./core/privacy-paths.js";
import type { ConversionReport, ThreadShiftBundle, Warning } from "./core/types.js";
import { resolveHarness, runProcess } from "./runtime/process.js";
import { requireCompatibleVersion } from "./runtime/compatibility.js";
import { compileSmart } from "./context/smart.js";
import { deriveHandoff, sanitizeHandoffFields } from "./context/handoff.js";
import { captureBundle, createReport, loadBundle } from "./pipeline.js";
import { compareWorkspace, excludeGeneratedOutput } from "./workspace/compare.js";
import { inspectWorkspace } from "./workspace/inspect.js";
import { prepareOpenCode, launchOpenCode, updateReport } from "./adapters/opencode/deliver.js";

interface Options {
  command: "handoff" | "export" | "import";
  from?: string;
  to?: string;
  session?: string;
  bundle?: string;
  output?: string;
  workspace?: string;
  mode: string;
  contextCharacters: number;
  handoffFile?: string;
  codexBin?: string;
  opencodeBin?: string;
  codexHome?: string;
  dryRun: boolean;
  launch: boolean;
  json: boolean;
  overwrite: boolean;
  acceptWorkspaceMismatch: boolean;
  attachBundle: boolean;
}

const help = `ThreadShift — portable coding-agent handoffs

Usage:
  threadshift handoff --from codex --to opencode --session <id> [options]
  threadshift export --from codex --session <id> [options]
  threadshift import --bundle <file> --to opencode [options]

Options:
  --workspace <dir>                 Workspace to inspect or continue in
  --output <path>                   Bundle file for export; package directory otherwise
  --mode smart|full|compact         Smart is implemented in this slice
  --context-chars <count>           Smart context character budget (default: 24000)
  --handoff-file <json>             Supply explicitly attributed handoff fields
  --codex-bin <path>                Codex executable override
  --opencode-bin <path>             OpenCode executable override
  --codex-home <dir>                Codex home for source access
  --dry-run                         Inspect and report without writing files
  --launch                          Explicitly start a fresh OpenCode run
  --attach-bundle                   Include the full sanitized archive in addition to context
  --overwrite                       Replace existing output
  --accept-workspace-mismatch       Continue after reviewing a changed snapshot
  --json                            Print a machine-readable report
  --help                            Show this help

The source session ID is required. Capture is read-only; historical commands are never replayed.
`;

const valueFlags = new Set([
  "--from", "--to", "--session", "--bundle", "--output", "--workspace", "--mode", "--context-chars",
  "--handoff-file", "--codex-bin", "--opencode-bin", "--codex-home",
]);
const booleanFlags = new Set(["--dry-run", "--launch", "--json", "--overwrite", "--accept-workspace-mismatch", "--attach-bundle"]);

function parseArgs(argv: string[]): Options | { help: true } {
  const [command, ...rest] = argv;
  if (command === "--help" || command === "-h" || command === undefined) return { help: true };
  if (command !== "handoff" && command !== "export" && command !== "import") throw new ThreadShiftError(`Unknown command '${command}'. Use handoff, export, or import.`, "INVALID_ARGUMENT");
  const values = new Map<string, string>();
  const flags = new Set<string>();
  for (let index = 0; index < rest.length; index++) {
    const argument = rest[index];
    if (argument === undefined) throw new ThreadShiftError("Unexpected empty argument.", "INVALID_ARGUMENT");
    if (!argument.startsWith("--")) throw new ThreadShiftError(`Unexpected argument '${argument}'.`, "INVALID_ARGUMENT");
    if (booleanFlags.has(argument)) {
      if (flags.has(argument)) throw new ThreadShiftError(`Flag '${argument}' was provided more than once.`, "INVALID_ARGUMENT");
      flags.add(argument);
      continue;
    }
    if (!valueFlags.has(argument)) throw new ThreadShiftError(`Unknown option '${argument}'.`, "INVALID_ARGUMENT");
    const value = rest[++index];
    if (!value || value.startsWith("--")) throw new ThreadShiftError(`Option '${argument}' requires a value.`, "INVALID_ARGUMENT");
    if (values.has(argument)) throw new ThreadShiftError(`Option '${argument}' was provided more than once.`, "INVALID_ARGUMENT");
    values.set(argument, value);
  }
  const mode = values.get("--mode") ?? "smart";
  if (mode !== "smart") throw new ThreadShiftError(`Mode '${mode}' is not implemented yet; Smart is the supported mode in this slice.`, "INVALID_ARGUMENT");
  const contextCharacters = Number(values.get("--context-chars") ?? 24_000);
  if (!Number.isSafeInteger(contextCharacters) || contextCharacters <= 0) throw new ThreadShiftError("--context-chars must be a positive integer.", "INVALID_ARGUMENT");
  const options: Options = {
    command,
    mode,
    contextCharacters,
    dryRun: flags.has("--dry-run"),
    launch: flags.has("--launch"),
    json: flags.has("--json"),
    overwrite: flags.has("--overwrite"),
    acceptWorkspaceMismatch: flags.has("--accept-workspace-mismatch"),
    attachBundle: flags.has("--attach-bundle"),
    ...(values.has("--from") ? { from: values.get("--from")! } : {}),
    ...(values.has("--to") ? { to: values.get("--to")! } : {}),
    ...(values.has("--session") ? { session: values.get("--session")! } : {}),
    ...(values.has("--bundle") ? { bundle: values.get("--bundle")! } : {}),
    ...(values.has("--output") ? { output: values.get("--output")! } : {}),
    ...(values.has("--workspace") ? { workspace: values.get("--workspace")! } : {}),
    ...(values.has("--handoff-file") ? { handoffFile: values.get("--handoff-file")! } : {}),
    ...(values.has("--codex-bin") ? { codexBin: values.get("--codex-bin")! } : {}),
    ...(values.has("--opencode-bin") ? { opencodeBin: values.get("--opencode-bin")! } : {}),
    ...(values.has("--codex-home") ? { codexHome: values.get("--codex-home")! } : {}),
  };
  if (options.dryRun && options.launch) throw new ThreadShiftError("--dry-run and --launch cannot be used together.", "INVALID_ARGUMENT");
  if (command === "handoff" || command === "export") {
    if (options.from !== "codex") throw new ThreadShiftError(`--from codex is required for ${command}.`, "INVALID_ARGUMENT");
    if (!options.session) throw new ThreadShiftError("--session <id> is required; session selection is explicit in this slice.", "INVALID_ARGUMENT");
  }
  if (command === "handoff" && options.to !== "opencode") throw new ThreadShiftError("--to opencode is required for handoff.", "INVALID_ARGUMENT");
  if (command === "import") {
    if (!options.bundle) throw new ThreadShiftError("--bundle <file> is required for import.", "INVALID_ARGUMENT");
    if (options.to !== "opencode") throw new ThreadShiftError("--to opencode is required for import.", "INVALID_ARGUMENT");
  }
  if (command === "export" && options.launch) throw new ThreadShiftError("--launch is only supported by handoff or import.", "INVALID_ARGUMENT");
  if (command === "export" && options.to) throw new ThreadShiftError("export writes a canonical bundle and does not take --to.", "INVALID_ARGUMENT");
  if (command === "export" && options.attachBundle) throw new ThreadShiftError("--attach-bundle is only supported by handoff or import.", "INVALID_ARGUMENT");
  if (command !== "import" && options.acceptWorkspaceMismatch) throw new ThreadShiftError("--accept-workspace-mismatch is only supported by import.", "INVALID_ARGUMENT");
  if (command === "import" && (options.codexBin || options.codexHome || options.session || options.from)) throw new ThreadShiftError("Codex source flags cannot be used while importing a saved bundle.", "INVALID_ARGUMENT");
  return options;
}

async function readHandoffFields(path: string | undefined): Promise<unknown> {
  if (!path) return undefined;
  const metadata = await stat(path);
  if (!metadata.isFile() || metadata.size > 256 * 1024) throw new ThreadShiftError("Handoff fields must be a JSON file no larger than 256 KiB.", "INVALID_HANDOFF_FIELDS");
  try {
    return JSON.parse(await readFile(path, "utf8")) as unknown;
  } catch (error) {
    throw new ThreadShiftError("Handoff fields are not valid JSON.", "INVALID_HANDOFF_FIELDS", { cause: error });
  }
}

async function destinationVersion(opencodeBin?: string): Promise<{ descriptor: Awaited<ReturnType<typeof resolveHarness>>; version: string }> {
  const descriptor = await resolveHarness("opencode", opencodeBin);
  const result = await runProcess({ executable: descriptor.executable, args: [...descriptor.argsPrefix, "--version"], cwd: process.cwd(), timeoutMs: 5_000, maxOutputBytes: 16 * 1024 });
  if (result.exitCode !== 0) throw new ThreadShiftError("Could not read the OpenCode CLI version.", "UNSUPPORTED_RUNTIME");
  const version = result.stdout.match(/(?:opencode\s+)?v?(\d+\.\d+\.\d+)/i)?.[1];
  if (!version) throw new ThreadShiftError("OpenCode returned an unrecognized version string.", "UNSUPPORTED_RUNTIME");
  requireCompatibleVersion("opencode", version);
  return { descriptor, version };
}

function isWithin(root: string, target: string): boolean {
  const path = relative(root, target);
  return path === "" || (!path.startsWith(`..${sep}`) && path !== ".." && !isAbsolute(path));
}

function addOutputWarning(warnings: Warning[], root: string, output: string): void {
  if (isWithin(root, output)) warnings.push({ code: "OUTPUT_INSIDE_WORKSPACE", message: "The handoff package is inside the workspace and will appear as generated local files; an output directory outside the workspace is cleaner.", eventIds: [] });
}

function reportOutput(options: Options, report: ConversionReport): void {
  if (options.json) process.stdout.write(`${JSON.stringify(report)}\n`);
  else {
    process.stdout.write(`ThreadShift ${report.preparation}: ${report.preservedCounts.events} events preserved, ${report.selectedCounts.events} selected.\n`);
    if (report.launch) process.stdout.write(`OpenCode ${report.launch.status}${report.launch.sessionId ? ` (${report.launch.sessionId})` : ""}.\n`);
    for (const warning of report.warnings) process.stdout.write(`Warning: ${warning.message}\n`);
  }
}

async function outputPath(options: Options, bundle: ThreadShiftBundle): Promise<string> {
  if (options.output) return resolve(options.output);
  const base = join(homedir(), ".threadshift", options.command === "export" ? "exports" : "handoffs");
  const output = join(base, options.command === "export" ? `${bundle.source.sessionId}.threadshift.json` : bundle.manifest.bundleId);
  await assertDefaultOutputContained(base, output);
  return output;
}

async function executeExport(options: Options, signal: AbortSignal): Promise<number> {
  const workspaceRoot = resolve(options.workspace ?? process.cwd());
  const handoffFields = await readHandoffFields(options.handoffFile);
  const { bundle } = await captureBundle({ sessionId: options.session!, workspaceRoot, ...(options.codexBin ? { codexBin: options.codexBin } : {}), ...(options.codexHome ? { codexHome: options.codexHome } : {}), handoffFields }, signal);
  const output = await outputPath(options, bundle);
  const summary = { status: options.dryRun ? "dry-run" : "exported", bundleId: bundle.manifest.bundleId, path: output, completeness: bundle.manifest.completeness, counts: bundle.manifest.counts, warnings: bundle.warnings };
  if (!options.dryRun) await writeBundle(output, bundle, { overwrite: options.overwrite });
  if (options.json) process.stdout.write(`${JSON.stringify(summary)}\n`);
  else process.stdout.write(`ThreadShift ${summary.status}: ${summary.counts.events} events, ${summary.counts.rawRecords} records${options.dryRun ? " (no files written)" : ` → ${output}`}\n`);
  return 0;
}

async function executeHandoff(options: Options, signal: AbortSignal): Promise<number> {
  const workspaceRoot = resolve(options.workspace ?? process.cwd());
  const handoffFields = await readHandoffFields(options.handoffFile);
  const { bundle, workspace } = await captureBundle({ sessionId: options.session!, workspaceRoot, ...(options.codexBin ? { codexBin: options.codexBin } : {}), ...(options.codexHome ? { codexHome: options.codexHome } : {}), handoffFields }, signal);
  const destination = await destinationVersion(options.opencodeBin);
  const context = compileSmart(bundle, { maxCharacters: options.contextCharacters });
  const output = await outputPath(options, bundle);
  await assertSafePackageOutput(output, [workspace.root]);
  const warnings: Warning[] = [];
  addOutputWarning(warnings, workspace.root, output);
  const report = createReport(bundle, context, destination.version, { preparation: options.dryRun ? "dry-run" : "prepared", warnings });
  report.outputPaths = { bundle: join(output, "session.threadshift.json"), context: join(output, "continuation.md"), report: join(output, "report.json") };
  if (options.dryRun) {
    reportOutput(options, report);
    return 0;
  }
  const prepared = await prepareOpenCode(output, bundle, context, report, destination.descriptor, { overwrite: options.overwrite, attachBundle: options.attachBundle });
  if (options.launch) {
    const current = await inspectWorkspace(prepared.workspaceRoot);
    const comparisonWarnings = compareWorkspace(
      excludeGeneratedOutput(workspace, output),
      excludeGeneratedOutput(current, output),
      options.acceptWorkspaceMismatch,
    );
    const delivery = await launchOpenCode(prepared.launch, signal);
    report.warnings.push(...comparisonWarnings, ...delivery.warnings);
    report.launch = { status: delivery.status, exitCode: delivery.exitCode, ...(delivery.sessionId ? { sessionId: delivery.sessionId } : {}) };
    if (delivery.status === "failed") {
      report.warnings.push({ code: "DESTINATION_LAUNCH_FAILED", message: delivery.error ?? "OpenCode launch failed; prepared files were retained.", eventIds: [] });
      await updateReport(prepared.reportPath, report);
      reportOutput(options, report);
      return 1;
    }
    await updateReport(prepared.reportPath, report);
  }
  reportOutput(options, report);
  return 0;
}

async function executeImport(options: Options, signal: AbortSignal): Promise<number> {
  const originalBundle = await loadBundle(resolve(options.bundle!));
  const workspaceRoot = resolve(options.workspace ?? originalBundle.workspace.root);
  try {
    const metadata = await stat(workspaceRoot);
    if (!metadata.isDirectory()) throw new Error("not a directory");
  } catch {
    if (!options.workspace) throw new ThreadShiftError("The captured workspace is missing; pass --workspace <dir> to choose a local workspace explicitly.", "MISSING_WORKSPACE");
    throw new ThreadShiftError(`Workspace override does not exist: ${workspaceRoot}`, "MISSING_WORKSPACE");
  }
  const currentWorkspace = await inspectWorkspace(workspaceRoot);
  const privacyRules = await loadPrivacyRules(currentWorkspace.root, currentWorkspace.git.root ?? currentWorkspace.root);
  const safeOriginal = sanitizeBundle(originalBundle, privacyRules);
  const workspaceWarnings = compareWorkspace({ root: originalBundle.workspace.root, digest: originalBundle.workspace.digest }, currentWorkspace, options.acceptWorkspaceMismatch);
  const handoffFields = await readHandoffFields(options.handoffFile);
  const bundle = handoffFields === undefined
    ? safeOriginal
    : (() => {
      const sanitized = sanitizeHandoffFields(handoffFields);
      return sanitizeBundle({ ...safeOriginal, warnings: [...safeOriginal.warnings, ...sanitized.warnings], handoff: deriveHandoff({ events: safeOriginal.history.events }, currentWorkspace, sanitized.fields) }, privacyRules);
    })();
  const destination = await destinationVersion(options.opencodeBin);
  const context = compileSmart(bundle, { maxCharacters: options.contextCharacters });
  const output = await outputPath(options, bundle);
  await assertSafePackageOutput(output, [currentWorkspace.root, resolve(options.bundle!)]);
  const warnings = [...workspaceWarnings];
  addOutputWarning(warnings, currentWorkspace.root, output);
  const report = createReport(bundle, context, destination.version, { preparation: options.dryRun ? "dry-run" : "prepared", warnings });
  report.outputPaths = { bundle: join(output, "session.threadshift.json"), context: join(output, "continuation.md"), report: join(output, "report.json") };
  if (options.dryRun) {
    reportOutput(options, report);
    return 0;
  }
  const prepared = await prepareOpenCode(output, bundle, context, report, destination.descriptor, { overwrite: options.overwrite, workspaceRoot: currentWorkspace.root, protectedPaths: [resolve(options.bundle!)], attachBundle: options.attachBundle });
  if (options.launch) {
    const latestWorkspace = await inspectWorkspace(currentWorkspace.root);
    const capturedWorkspace = { ...originalBundle.workspace, git: originalBundle.git, warnings: [] };
    const latestWarnings = compareWorkspace(
      excludeGeneratedOutput(capturedWorkspace, output),
      excludeGeneratedOutput(latestWorkspace, output),
      options.acceptWorkspaceMismatch,
    );
    const delivery = await launchOpenCode(prepared.launch, signal);
    report.warnings.push(...latestWarnings, ...delivery.warnings);
    report.launch = { status: delivery.status, exitCode: delivery.exitCode, ...(delivery.sessionId ? { sessionId: delivery.sessionId } : {}) };
    if (delivery.status === "failed") {
      report.warnings.push({ code: "DESTINATION_LAUNCH_FAILED", message: delivery.error ?? "OpenCode launch failed; prepared files were retained.", eventIds: [] });
      await updateReport(prepared.reportPath, report);
      reportOutput(options, report);
      return 1;
    }
    await updateReport(prepared.reportPath, report);
  }
  reportOutput(options, report);
  return 0;
}

export async function main(argv = process.argv.slice(2)): Promise<number> {
  let options: Options | { help: true };
  try {
    options = parseArgs(argv);
    if ("help" in options) {
      process.stdout.write(help);
      return 0;
    }
    const controller = new AbortController();
    const abort = () => controller.abort();
    process.once("SIGINT", abort);
    process.once("SIGTERM", abort);
    try {
      if (options.command === "export") return await executeExport(options, controller.signal);
      if (options.command === "handoff") return await executeHandoff(options, controller.signal);
      return await executeImport(options, controller.signal);
    } finally {
      process.removeListener("SIGINT", abort);
      process.removeListener("SIGTERM", abort);
    }
  } catch (error) {
    const code = error instanceof ThreadShiftError ? error.code : "THREADSHIFT_FAILED";
    const message = error instanceof Error ? error.message : String(error);
    if (argv.includes("--json")) process.stdout.write(`${JSON.stringify({ error: { code, message } })}\n`);
    else process.stderr.write(`ThreadShift error [${code}]: ${message}\n`);
    return 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  process.exitCode = await main();
}
