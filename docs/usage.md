# Usage and troubleshooting

`handoff` captures Codex or OpenCode and prepares a package for the other agent. `export` writes a mode-independent canonical bundle. `import` validates a saved bundle and prepares a package. Only Smart destination context is implemented; full/compact requests fail clearly.

## Options

| Option | Purpose |
| --- | --- |
| `--session ID` | Explicit Codex source identity; required for export/handoff |
| `--workspace DIR` | Workspace to inspect or explicitly replace a missing imported root |
| `--output PATH` | Bundle file for export, package directory for handoff/import |
| `--context-chars N` | Positive integer Smart Unicode code-point budget; default 24000 |
| `--handoff-file FILE` | JSON with objective/currentState and list fields completed, decisions, remaining, blockers, nextActions, importantFiles, verificationState, activePlan |
| `--dry-run` | Read and report without writing outputs or starting inference |
| `--launch` | Explicit fresh OpenCode inference; incompatible with dry run |
| `--attach-bundle` | Explicitly attach the full sanitized archive; default is selected context only |
| `--accept-workspace-mismatch` | Import only; accept reported root/state differences |
| `--overwrite` | Replace an existing output |
| `--codex-bin PATH`, `--opencode-bin PATH` | Explicit harness executable/script |
| `--codex-home DIR` | Codex session store selection; source commands only |
| `--json` | Machine-readable result/error on stdout |

Without `--output`, files go under the user's `~/.threadshift/exports` or `~/.threadshift/handoffs`. Source capture reads the selected agent store; ThreadShift does not load authentication files. The destination inherits its own provider configuration at launch.

## Errors and recovery

- **Unsupported runtime:** use the exact tested versions in compatibility.md; arbitrary wrapper scripts are rejected rather than run through a shell.
- **Active/changing source:** pause Codex at a completed turn and retry. Capture repeats all full-item pages and rejects detectable changes.
- **Required context exceeds budget:** raise `--context-chars`. The latest request is never silently cut.
- **Workspace mismatch:** compare the recorded and current workspace before using the explicit acceptance flag. No patches are applied.
- **Output exists:** choose a new directory or use `--overwrite` after reviewing it.
- **Failed/cancelled destination:** canonical bundle and context remain available. Read `report.json`; preparation can succeed even when launch fails. Ctrl+C cancels the launched harness process.
- **No destination session identity/malformed JSON/error event:** launch reports failure even when the process exits zero. A missing final step event is disclosed as a warning; a session identity is not proof that the task was completed.

## Evidence boundaries

The sanitized canonical archive and selected context are separate. Context omissions do not delete canonical records. Only context is attached by default; `--attach-bundle` also sends the archive. Capture, import and persistence sanitize credentials and private reasoning, but arbitrary secrets may remain. Declare confidential paths in `.threadshiftignore` and review exports before sharing. See [privacy controls](privacy.md).

Git evidence includes HEAD, status, relevant file digests and sanitized text patches. Secret files and project exclusions contribute no patch content or hash, including renamed source paths. Binary/oversized patches are disclosed. Other untracked contents are referenced and hashed rather than copied. Known instruction files are referenced, not executed. Two state reads detect ordinary changes but are not a filesystem transaction.

When the selected workspace is a repository subfolder, launch stays in that subfolder while Git paths are resolved from the recorded repository root. Supplied handoff fields receive the same credential-pattern sanitizer as source records. Source-home overrides must already exist. Package replacement checks physical paths twice so existing symlink/junction ancestors cannot bypass workspace/input protection; concurrent hostile filesystem replacement is outside this local consistency check.

Cancellation uses a POSIX process group with forced escalation, or Windows taskkill for the spawned harness tree. OS-denied tree termination falls back to force-killing the root; descendant cleanup cannot be certified in that environment. POSIX behavior must still pass on the actual macOS/Linux runners.

Non-Git workspaces have no general content inventory or change detection; they record known instruction references and root metadata. Move the project yourself when changing machines. The bundle does not copy your repository.

Source `complete` means all safely readable records returned by the pinned protocol survived a stable double read, with disclosed exclusions. A populated real-session count comparison and cross-process consistency acceptance are still pending. Fixture continuation proves attachment/argument plumbing; it cannot establish that an actual model understood or completed a task.

## OpenCode to Codex

Use `handoff --from opencode --to codex --session ID`, `export --from opencode --session ID`, or `import --bundle FILE --to codex`. Supply `--workspace` and an output path outside the workspace. `--codex-bin` selects the Codex destination executable; `--opencode-bin` selects the OpenCode source executable. Source-only `--from`, `--session` and `--codex-home` are rejected on import. Same-agent handoffs and other agents are unsupported. Import destination selection is independent of the saved source.

Capture uses a private unregistered loopback helper and only selected-session GET requests, following every message page twice. Pause the source first. Unknown boundaries or unaccounted fork history are disclosed as incomplete and block automatic Codex launch (`SOURCE_INCOMPLETE`), while preparation/export remain available. No native messages are injected or replayed.

Codex launch uses `exec --json -` with the selected continuation through stdin. `--attach-bundle` adds the complete sanitized archive explicitly. A valid `thread.started` identity, ordered started/completed turn, no error and zero exit are all required for success. This differs from the existing OpenCode process gate described above. Normal agent configuration applies; ThreadShift does not override model, authentication or approval settings.

For a manual Codex retry, read `report.json`'s `launchInstructions`: change to `cwd`, combine `stdinPreamble` and the UTF-8 contents of `stdinFiles` (in order, separated by two newlines), and pipe that text to the exact executable and argument array. Review these files first. In PowerShell with a normal Codex installation:

```powershell
$r = Get-Content "C:\path\to\handoff\report.json" -Raw | ConvertFrom-Json
$text = $r.launchInstructions.stdinPreamble + (($r.launchInstructions.stdinFiles | ForEach-Object { [System.IO.File]::ReadAllText($_) }) -join "`n`n")
Set-Location $r.launchInstructions.cwd
$text | & $r.launchInstructions.executable @($r.launchInstructions.args)
```

The native source stores, auth, configuration and provider-private state stay local. The report contains the input recipe, not a duplicate transcript. Repeated handovers may quote earlier continuations as history; they do not merge or fabricate native source identities. Smart selection can omit older context with disclosed budget/omission counts; its historical test results are not current verification.

## Pi sessions and six directions

Use `codex`, `opencode`, or `pi` for `--from` and `--to`, choosing different agents for a handoff. `export --from pi` emits schema 3. Schemas 1 and 2 remain readable; import accepts every known source independently of the destination.

Pi 1.0.2 stores format-3 JSONL. Choose an exact ID in the selected project's store, or a specific JSONL path. Pi's default agent directory is `~/.pi/agent`; `--pi-home` overrides it for source lookup. `PI_CODING_AGENT_SESSION_DIR` overrides the native store directory when set. The source header must match the selected workspace. A branched file requires explicit `--pi-leaf ENTRY_ID`, because navigation alone does not persist an active cursor. Capture reads the selected file twice and rejects observed changes. Keep the source paused; this is a stable observation, not an exclusive lock.

Pi source reports include total/selected/excluded tree-entry counts. Each selected entry and the header appear once in canonical raw records. Unknown completion evidence is incomplete; pending requests/tools block capture. Parent-session paths are not followed. Pi custom IDs, including `CON`, remain native identities; default export filenames use the bundle ID for portability.

Pi delivery uses a new persisted session and stdin, with no resume, fork, session selection, model, authentication or approval overrides. Review `report.json`'s executable, argument array, cwd, stdinFiles and stdinPreamble. To retry manually, concatenate the preamble and listed files in order and pipe them into that exact invocation from the recorded cwd. On PowerShell:

```powershell
$r = Get-Content -LiteralPath 'C:\handoff\report.json' -Raw | ConvertFrom-Json
$i = $r.launchInstructions
$text = $i.stdinPreamble + (($i.stdinFiles | ForEach-Object { Get-Content -LiteralPath $_ -Raw }) -join "`n`n")
Push-Location -LiteralPath $i.cwd
try { $text | & $i.executable @($i.args) } finally { Pop-Location }
```

`--launch` requires a complete source for every Pi-related route. Success requires a consistent session header, authoritative completed assistant and turn, no pending tools or unrecovered failure, final `agent_settled` and zero exit. ThreadShift invokes Pi once; Pi may perform its own automatic recovery, which is reported. Preparation files remain after failure. Native editing acceptance remains a separate check.
