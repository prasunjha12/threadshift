import { ThreadShiftError } from "../core/errors.js";

export const CODEX_COMPATIBLE_VERSIONS = new Set(["0.162.1"]);
export const OPENCODE_COMPATIBLE_VERSIONS = new Set(["2.0.22"]);

export function requireCompatibleVersion(harness: "codex" | "opencode" | "pi", version: string): void {
  const compatible = { codex: CODEX_COMPATIBLE_VERSIONS, opencode: OPENCODE_COMPATIBLE_VERSIONS, pi: new Set(["1.0.2"]) }[harness];
  if (!compatible.has(version)) {
    throw new ThreadShiftError(`Unsupported ${harness} version ${version}; verified versions: ${[...compatible].join(", ")}`, "UNSUPPORTED_RUNTIME");
  }
}
