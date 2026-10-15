export type ThreadShiftErrorCode =
  | "INVALID_BUNDLE"
  | "OUTPUT_EXISTS"
  | "SECRET_REDACTION"
  | "OUTPUT_CONFLICT"
  | "PROCESS_TIMEOUT"
  | "PROCESS_CANCELLED"
  | "EXECUTABLE_NOT_FOUND"
  | "PROCESS_FAILED"
  | "OUTPUT_LIMIT"
  | "SOURCE_INCOMPLETE"
  | "SOURCE_ACTIVE"
  | "SOURCE_CHANGED"
  | "CODEX_PROTOCOL"
  | "OPENCODE_PROTOCOL"
  | "CAPTURE_TOO_LARGE"
  | "UNSUPPORTED_RUNTIME"
  | "WORKSPACE_CHANGED"
  | "WORKSPACE_MISMATCH"
  | "CONTEXT_BUDGET"
  | "INVALID_HANDOFF_FIELDS"
  | "INVALID_ARGUMENT"
  | "DESTINATION_FAILED"
  | "MISSING_WORKSPACE";

export class ThreadShiftError extends Error {
  constructor(message: string, readonly code: ThreadShiftErrorCode, options?: ErrorOptions) {
    super(message, options);
    this.name = "ThreadShiftError";
  }
}
