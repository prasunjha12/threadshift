# Harness compatibility: first-slice probes

## Reverse-flow contract investigation, 2026-10-15

Pinned OpenCode 2.0.22 exposes `session export`, `session import`, `api`, and `serve --stdio --hostname 127.0.0.1 --port 0`. Its native export uses `{ info, messages }` with flat `user`, `assistant`, `idle`, shell, compaction and control messages. Assistant content contains text/reasoning/tool objects; text content has no native part ID, so structural content indexes must be distinguished from native identities.

The matching official `@opencode/schema`, `@opencode/client` and `@opencode/core` 2.0.22 npm distributions were inspected as protocol references only, not added as project dependencies. An isolated native server and supported native import created a synthetic completed session. Two exports matched exactly, and forced one-message API pages accounted independently for its three messages. No provider inference or personal session access was used for this probe.

The export implementation filters unfinished assistant, shell and compaction records. Therefore the reverse reader uses the supported unfiltered API instead: `GET /api/session/:id` and `GET /api/session/:id/message`. JSON responses are enveloped in `data`; message pages also contain `cursor.previous` and `cursor.next`. The first page accepts `order=asc&limit=100`. Subsequent pages carry only the opaque cursor and limit: combining cursor with order is rejected. Every nonempty page has a next cursor; the final empty page has null cursors. The reader must follow that terminal page, not infer completion from a short page.

Use a private, unregistered `serve --stdio` helper bound to loopback, not the managed background service. The installed restart contract states that unregistered servers do not sweep/resume suspended executions. Stdout reports a JSON `url`; a generated per-helper `OPENCODE_SERVER_PASSWORD` enables Basic authentication. This password is held in memory, is never a provider credential, and is not logged or persisted by ThreadShift. Source operations are limited to selected-session GET requests; native logs/database housekeeping are distinct from conversation mutation. `XDG_DATA_HOME`, `XDG_CONFIG_HOME`, `XDG_CACHE_HOME`, and `XDG_STATE_HOME` successfully isolated the probe store.

Completed-boundary evidence consists of the durable final `idle` message, matching session idle/outcome metadata, completed assistant messages, and terminal tool/shell/compaction states. Two full metadata/page inventories must agree. This is an observed stable transcript boundary, not an exclusive source lock. Unknown boundary/coverage is incomplete and cannot trigger reverse launch.

Codex CLI 0.162.1 `exec --json -` accepts stdin and persists by default. The earlier authorized dummy native run emitted `thread.started` with `thread_id`, `turn.started`, `item.completed`, and `turn.completed`. The checked-in success contract is synthetic with that observed shape; failure examples are synthetic negative-parser cases, not claimed native failure observations. Native reverse continuation still requires acceptance testing.

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

## Pi 1.0.2 (format 3), 2026-10-15

Pinned installed `@earendil-works/pi-coding-agent` 1.0.2 on Windows/Node 24.12.0. Isolated `--version` returned 1.0.2 without loading a sentinel extension. Native SessionManager fixture setup confirmed format-3 JSONL headers, workspace paths, custom IDs, parent-linked entries, content edits wrapped as `{content: ...}`, and retain-none compaction anchoring to its own entry ID. Navigating a branch without appending did not persist the active cursor: branched source selection must be explicit. Parent-session paths are metadata and are never followed.

A native `--mode json` invocation with piped stdin, a fresh isolated home and a local OpenAI-compatible dummy provider persisted a fresh session, emitted `session`, `turn_start`, assistant `message_end` with `stopReason: stop`, `turn_end`, `agent_end`, then `agent_settled`, and exited zero. This checks native protocol behavior without claiming real model reasoning. The normal provider configuration had no usable login. Failure/recovery examples in fixtures are synthetic. Exit zero or `agent_end` alone does not establish successful settlement; aborted/error/unfinished tool activity must block success. Split JSON framing on LF only.

Version probes and source file reads do not request conversation mutation. Native destination sessions can perform runtime housekeeping and persist the explicitly requested new conversation. Public examples use synthetic identities; native scratch evidence stays outside this checkout. [Pi source](https://github.com/earendil-works/pi) and the installed matching SDK/types define this version scope.
