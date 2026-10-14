# Harness compatibility: first-slice probes

Last checked: 2026-10-13 on Windows 11, Node.js v24.12.0.

These are historical first-slice probe results, not a published support matrix. A later small Windows live run and the current privacy changes are recorded in [validation evidence](validation.md); broader native acceptance remains pending.

## Codex CLI 0.162.1

- The installed `codex app-server --help` exposes stdio transport (`--stdio`, default `stdio://`).
- In a fresh isolated `CODEX_HOME`, `initialize` followed by `initialized` succeeds. The initialization response included `userAgent`, `codexHome`, `platformFamily`, and `platformOs`.
- `thread/list` accepted `{ "limit": 1, "sortKey": "created_at", "sourceKinds": ["cli"] }` and returned `data`, `nextCursor`, and `backwardsCursor`. The isolated store correctly returned zero threads.
- The installed v2 protocol schema describes `thread/read` as metadata-only for paginated threads and deprecates full-history hydration. It defines `thread/turns/list` with opaque `nextCursor` pagination and `itemsView: "full"`, meaning every persisted item available for each returned turn.
- The source adapter opts into `experimentalApi`, reads metadata with `includeTurns: false`, then follows every turn page with `itemsView: "full"`. It repeats the complete read and compares metadata plus all turn/item records before claiming a complete capture.
- A synthetic two-page app-server fixture verifies all pages are read twice, no resume/start/turn operation is sent, and unknown records survive. A populated real paused-session count comparison remains pending before release acceptance.
- The isolated runtime probe used `initialize`, `thread/list`, and metadata `thread/read`; no thread was resumed, no turn was created, and no model inference was started.
- The probe had to use a temporary home. Codex attempted to clean/create its normal `~/.codex/tmp/arg0` aliases and logged sandbox access warnings; no personal session data was requested. The production adapter must isolate `CODEX_HOME` carefully and preserve the user's expected auth/session access without reading auth files itself.
- The installed app-server schema is the basis for the pagination contract. Because a populated real-session count comparison is still pending, compatibility claims remain limited to the isolated protocol probe plus synthetic fixture coverage.

## OpenCode CLI 2.0.22 (`@opencode/cli`)

- Version confirmed from the installed package metadata; `run --help` and `session import --help` succeeded in an isolated user/config/data home without inference.
- `run` accepts a message, `--file`, `--format json`, `--standalone`, and `--session`. Starting the process with the selected workspace as its working directory is the candidate fresh-session path.
- `session import` accepts a JSON file and `--directory`, but this does not establish that OpenCode accepts a ThreadShift bundle. Native history import remains disabled.
- No real provider call was made. Task 6 must verify file attachment, JSON completion, session ID and retry behavior using a fixture provider before the command claims launch success.

## Runtime and build

- Node.js `v24.12.0` is installed locally; the package currently requires Node 24.12.0 through the Node 24 major line.
- TypeScript `7.0.2` and `@types/node` `24.19.2` are recorded in `package-lock.json`. `npm run build`, `npm run typecheck`, and the five runtime subprocess tests passed on Windows.
- Runtime wrapper probe resolves the installed Codex PowerShell shim to its Node executable and entry script. Runtime subprocess tests cover literal Unicode/shell-like arguments, deadline cancellation, abort cancellation, missing binaries, and a Windows npm shim fixture. Codex fixture tests cover selection, multi-page stability, active/changing/malformed sessions, unsupported versions, unknown records, and input limits.
- Linux and macOS runners have not run yet.
