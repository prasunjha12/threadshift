import type { JsonValue, Warning } from "./types.js";

const credentialName = "(?:api[-_ ]?key|token|password|passwd|secret|authorization|private[-_ ]?key|client[-_ ]?secret|credentials?|(?:database|db|redis|mongodb)[-_]?(?:url|uri)|connection[-_ ]?string|dsn)";
const secretKey = new RegExp(credentialName.replace("|token", ""), "i");
const isCredentialKey = (key: string): boolean => secretKey.test(key) || /(?:^token$|(?:access|refresh|auth|session|id|bearer|api|github|gitlab|npm|gh)[-_]?token$|[_-]token$)/i.test(key);
const textValue = `(\"(?:\\\\.|[^\"\\\\])*\"|'(?:\\\\.|[^'\\\\])*'|\\[[^\\]\\r\\n]*\\][^\\s,;&<>]*|[^\\s,;&<>]+)`;
const assignment = new RegExp(`((?:[\\w.-]*${credentialName}[\\w.-]*)[\"']?\\s*[:=]\\s*)${textValue}`, "gi");
const flag = new RegExp(`(--[\\w-]*${credentialName}[\\w-]*\\s+)${textValue}`, "gi");
const markers = new Set(["[REDACTED:credential field]", "[REDACTED:credential pattern]", "[REDACTED:credential assignment]", "[REDACTED:credential URL]"]);
const recognizableSecret = /(?:\bsk-(?:proj-)?[A-Za-z0-9_-]{12,}\b|\bgh[pousr]_[A-Za-z0-9]{12,}\b|\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+/-]+=*|\b(?:AKIA|ASIA)[A-Z0-9]{16}\b|\bAIza[A-Za-z0-9_-]{35}\b|\bxox[baprs]-[A-Za-z0-9-]{12,}\b|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----)/gi;

export function redactRecord(record: JsonValue): { value: JsonValue; warnings: Warning[] } {
  let redacted = 0;
  const visit = (value: JsonValue, key = ""): JsonValue => {
    if (isCredentialKey(key) && value !== null) {
      if (typeof value === "string" && markers.has(value)) return value;
      redacted++;
      return "[REDACTED:credential field]";
    }
    if (typeof value === "string") {
      const maskAssignment = (match: string, prefix: string, content: string): string => {
        const name = prefix.replace(/\s*[:=]\s*$/, "").replace(/["']$/, "").trim().replace(/^--/, "");
        if (!isCredentialKey(name)) return match;
        const unquoted = /^["']/.test(content) ? content.slice(1, -1) : content;
        if (markers.has(unquoted)) return match;
        redacted++;
        return `${prefix}[REDACTED:credential assignment]`;
      };
      const masked = value.replace(recognizableSecret, () => {
        redacted++;
        return "[REDACTED:credential pattern]";
      }).replace(/([a-z][a-z0-9+.-]*:\/\/[^\s/:@]+:)[^\s@]+@/gi, (_match, prefix: string) => {
        redacted++;
        return `${prefix}[REDACTED:credential URL]@`;
      });
      return masked.replace(assignment, maskAssignment).replace(flag, maskAssignment);
    }
    if (Array.isArray(value)) return value.map((entry) => visit(entry));
    if (typeof value === "object" && value !== null) {
      return Object.fromEntries(Object.entries(value).map(([childKey, child]) => [childKey, visit(child, childKey)]));
    }
    return value;
  };
  const value = visit(record);
  return {
    value,
    warnings: redacted === 0 ? [] : [{
      code: "CREDENTIALS_REDACTED",
      message: `Redacted ${redacted} recognizable credential value(s); arbitrary secrets may remain.`,
      eventIds: [],
    }],
  };
}
