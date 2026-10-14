import { ThreadShiftError } from "../core/errors.js";

export const CODEX_COMPATIBLE_VERSIONS = new Set(["0.162.1"]);
export const OPENCODE_COMPATIBLE_VERSIONS = new Set(["2.0.22"]);

export function requireCompatibleVersion(harness: "codex" | "opencode", version: string): void {
  const compatible = harness === "codex" ? CODEX_COMPATIBLE_VERSIONS : OPENCODE_COMPATIBLE_VERSIONS;
  if (!compatible.has(version)) {
    throw new ThreadShiftError(`Unsupported ${harness} version ${version}; verified versions: ${[...compatible].join(", ")}`, "UNSUPPORTED_RUNTIME");
  }
}
