# ThreadShift

Move a paused coding task between Codex CLI and OpenCode while preserving safe conversation history and current workspace evidence.

This early source preview implements **Codex CLI → OpenCode, Smart mode**. A fresh Windows live handover completed without follow-up clarification after the privacy fixes. Native process completion and macOS/Linux validation remain release gates. See [validation evidence](docs/validation.md).

## Set up

Use Node.js 24.12.0 through the Node 24 line, Git, Codex CLI **0.162.1**, and OpenCode **2.0.22** (`@opencode/cli`). Other harness versions fail until their contracts are verified.

```sh
npm ci
npm run build
node dist/cli.js --help
```

There is no published npm release. To install this checkout locally, build it, run `npm pack`, then install the resulting tarball with `npm install -g ./threadshift-0.1.0.tgz`. The installed command is `threadshift`; the examples below use the checkout directly.

## Prepare a handoff

Pause the source task at a completed turn and obtain its Codex session ID. Use an existing workspace and an output directory outside it:

```sh
node dist/cli.js handoff --from codex --to opencode --session SESSION_ID --workspace "/path/to/project" --output "/path/to/handoff" --dry-run --json
node dist/cli.js handoff --from codex --to opencode --session SESSION_ID --workspace "/path/to/project" --output "/path/to/handoff"
```

Windows paths work with quotes, for example `--workspace "C:\Projects\My App"`. Dry run inspects the source and workspace without creating handoff files or starting inference. Preparation produces:

- `session.threadshift.json`: sanitized local archive of canonical history, raw records, workspace/Git evidence and attributed handoff fields.
- `continuation.md`: selected Smart context, bounded to 24,000 Unicode characters by default.
- `report.json`: counts, warnings, output paths, versions and exact executable/argument array/working directory for launch.

Review the package, then explicitly start OpenCode by rerunning the handoff with `--launch` and a new output directory (or `--overwrite` to replace that package). Launch starts inference using OpenCode's configured provider and creates a fresh session. It does not import native database history. Preparation and launch have separate success states; failure retains the package for retry.

OpenCode receives **only `continuation.md` by default**. The complete archive stays local. Add `--attach-bundle` only after reviewing the archive if you want to include all retained history and patches.

## Continue OpenCode work in Codex

Pause OpenCode at a completed turn and use its explicit session ID:

```sh
node dist/cli.js handoff --from opencode --to codex --session SESSION_ID --workspace "/path/to/project" --output "/path/to/reverse-handoff" --dry-run --json
node dist/cli.js handoff --from opencode --to codex --session SESSION_ID --workspace "/path/to/project" --output "/path/to/reverse-handoff" --launch
```

Codex receives the saved sanitized continuation through stdin, using `codex exec --json -`. It uses your normal configured authentication, model and approval rules. ThreadShift reports launch success only after a valid session identity, a completed turn and zero process exit. Incomplete OpenCode captures can be exported or prepared for review, but cannot launch automatically. Forked sessions remain incomplete until inherited history can be independently accounted for.

OpenCode exports use bundle schema 2; existing schema-1 Codex bundles remain readable. Use `export --from opencode` to save a bundle and `import --to codex` to prepare it later. See [usage and manual retry](docs/usage.md).

## Privacy before handover

Credential fields, labelled assignments, common token formats, authentication headers and credential-bearing URLs are redacted during capture, import and persistence. Common secret files are excluded from patches and hashing. Add project-specific confidential paths to `.threadshiftignore` in the workspace or repository root:

```text
client-data/
internal-notes.txt
reports/**
```

These rules also exclude matching historical file content and imported patches. Paths and change metadata may remain. Review the generated context before launch: arbitrary confidential prose, encoded secrets and unknown credential formats cannot be detected reliably. The destination agent can still read workspace files under its own permissions. See [privacy controls and limits](docs/privacy.md).

## Save and reopen

```sh
node dist/cli.js export --from codex --session SESSION_ID --workspace "/path/to/project" --output "/path/to/saved.threadshift.json"
node dist/cli.js import --bundle "/path/to/saved.threadshift.json" --to opencode --output "/path/to/handoff"
```

Import uses the recorded workspace. If it is missing, supply `--workspace`; changed workspaces require `--accept-workspace-mismatch`. Inspect the warning before accepting. Existing outputs require `--overwrite`. Output must not replace a workspace or an ancestor, or contain the bundle being imported.

## Supply task state

Use `--handoff-file task-state.json` for facts you want to state explicitly:

```json
{
  "objective": "Fix the parser's Unicode handling",
  "decisions": ["Keep the current parser interface"],
  "remaining": ["Add a regression test"],
  "verificationState": ["The last recorded test run failed"],
  "nextActions": ["Inspect parser.ts"]
}
```

These fields are labeled user-supplied and cannot replace source records. Unknown objective/state stays unknown. Historical commands and tests are labeled historical evidence.

See [usage and troubleshooting](docs/usage.md), [compatibility](docs/compatibility.md), and [validation](docs/validation.md). Run `npm test`, `npm run typecheck`, and `npm run test:package` to check the checkout.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development checks and the current scope. Report bugs through [GitHub issues](https://github.com/prasunjha12/threadshift/issues). For sensitive reports, follow [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE). The package remains marked private to prevent accidental npm publication; the source is available on GitHub.
