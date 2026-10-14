import { lstat, readFile } from "node:fs/promises";
import { join } from "node:path";
import { ThreadShiftError } from "./errors.js";

export function assertSafeIdentifier(value: string, label: string): void {
  if (!/^[a-z0-9][a-z0-9_-]{0,127}$/i.test(value) || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(value)) {
    throw new ThreadShiftError(`${label} must be a portable identifier containing only letters, numbers, hyphens and underscores.`, "INVALID_BUNDLE");
  }
}

function normalized(value: string): string {
  let path = value;
  for (let count = 0; count < 2; count++) {
    try { const decoded = decodeURIComponent(path); if (decoded === path) break; path = decoded; } catch { break; }
  }
  return path.replaceAll("\\", "/").replace(/^\.\//, "").toLowerCase();
}

function globSource(rule: string): string {
  const pattern = normalized(rule).replace(/\/$/, "/**");
  return pattern.split("**").map((part) => part.split("*").map((piece) => piece.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("[^/]*")).join(".*");
}

export function isPrivatePath(value: string, rules: string[] = []): boolean {
  const path = normalized(value);
  if (/(?:^|\/)(?:\.env(?:\.[^/]*)?|\.npmrc|\.netrc|\.pypirc|\.git-credentials|auth\.json|opencode\.jsonc?|credentials(?:\.[^/]*)?|secrets?(?:\.[^/]*)?|id_(?:rsa|dsa|ecdsa|ed25519)(?:\.pub)?)(?:\/|$)/i.test(path)
    || /(?:^|\/)(?:\.aws|\.ssh|\.kube|\.codex|\.docker|\.azure|private|confidential)(?:\/|$)/i.test(path)
    || /\.(?:pem|key|p12|pfx|kdbx|keystore)$/i.test(path)) return true;
  return rules.some((rule) => {
    return new RegExp(`(?:^|/)${globSource(rule)}$`, "i").test(path);
  });
}

export function referencesPrivatePath(value: string, rules: string[] = []): boolean {
  if (rules.some((rule) => new RegExp(`(?:^|[\\s"'\x60=<>/])${globSource(rule)}(?=$|[\\s"'\x60<>),;/])`, "i").test(normalized(value)))) return true;
  const readCommand = /\b(?:cat|type|read(?:[_ -]?file)?|get-content|sed|head|tail)\b/i.test(value);
  return value.split(/[\s"'`<>()\[\]{},;]+/u).some((word) => {
    const candidates = [word, ...word.split("="), word.replace(/^[+\-]/, "")];
    return candidates.some((candidate) => {
      const path = candidate.replace(/[.:]+$/, "");
      if (!readCommand && !/[./\\]/.test(path)) return false;
      return isPrivatePath(path, rules);
    });
  });
}

export async function loadPrivacyRules(...roots: string[]): Promise<string[]> {
  const rules: string[] = [];
  for (const root of new Set(roots)) {
    const path = join(root, ".threadshiftignore");
    try {
      const metadata = await lstat(path);
      if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size > 64 * 1024) {
        throw new ThreadShiftError(".threadshiftignore must be a regular file no larger than 64 KiB.", "INVALID_ARGUMENT");
      }
      for (const line of (await readFile(path, "utf8")).split(/\r?\n/)) {
        const rule = line.trim();
        if (!rule || rule.startsWith("#")) continue;
        if (rule.startsWith("!") || rule.includes("..") || /^[/\\]|^[a-z]:/i.test(rule)) {
          throw new ThreadShiftError(".threadshiftignore accepts only relative exclusion paths and * or ** patterns; negation is not supported.", "INVALID_ARGUMENT");
        }
        rules.push(rule);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  return [...new Set(rules)];
}
