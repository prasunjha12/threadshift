# Usage and troubleshooting

`handoff` captures Codex and prepares an OpenCode package. `export` writes a mode-independent canonical bundle. `import` validates a saved bundle and prepares a package. Only Smart destination context is implemented; full/compact requests fail clearly.

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

Without `--output`, files go under the user's `~/.threadshift/exports` or `~/.threadshift/handoffs`. Source capture reads the configured Codex store; ThreadShift does not load authentication files. OpenCode inherits its own provider configuration at launch.

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
