# Privacy controls and limits

ThreadShift prepares files locally. Only an explicit `--launch` starts destination inference. The default destination attachment is the selected `continuation.md`; the sanitized full archive stays local. `--attach-bundle` explicitly includes that archive, including retained raw history and patches omitted from Smart context. Review both attachments before enabling it.

## Credentials and imported data

Capture, import, context compilation and bundle persistence share confidentiality processing. It masks credential-valued JSON fields, labelled assignments in text/JSON/shell arguments, common token formats, Basic/Bearer headers and credential-bearing URLs. Imported private reasoning is excluded too, including nested records and linked event/evidence copies. Unknown fields on typed schema wrappers are removed; safe unknown JSON inside raw records remains available. IDs and links survive processing, omissions are disclosed, and digests are recomputed for the sanitized evidence. Saved input files are not modified by import. Package persistence regenerates continuation context from the sanitized bundle instead of trusting precompiled text supplied by a caller.

Bundle and source identifiers must be portable single components (letters, numbers, hyphens and underscores; no Windows device names). Default outputs must remain inside their resolved ThreadShift directory, including through filesystem aliases. Explicit output paths remain user choices, subject to existing workspace/input protection.

## File exclusions

Before reading file bytes for hashes or patches, workspace inspection checks changed and original rename paths. Built-in exclusions include `.env` variants, credential files, SSH private-key names, `.npmrc`, `.netrc`, `.pypirc`, `.git-credentials`, authentication-bearing OpenCode config files, common private-key/container extensions, and `.aws`, `.ssh`, `.kube`, `.codex`, `.docker`, `.azure`, `private` and `confidential` directories. Example environment files are conservatively excluded too.

Add other private paths to `.threadshiftignore` in the selected workspace or Git repository root. Use one relative exclusion per line. `#` starts a comment line, `*` matches within a path segment, `**` matches across segments, and a trailing `/` excludes a directory's descendants. Negation, absolute paths and parent traversal are rejected. This is a small exclusion format, not the full Git ignore language. Rules also apply to imported patches and historical records that reference excluded paths. For safety, a matching historical record and its linked event/handoff copies can be replaced wholesale with an exclusion marker.

Excluded file contents and hashes are omitted; filenames and change metadata may remain. Untracked content is not copied as a patch, but ordinary untracked files can be hashed. Binary patch contents are omitted. The bundle is not a copy of your repository.

## What these controls do not prove

No pattern system can identify every arbitrary secret or confidential sentence. Label sensitive paths, avoid putting credentials into coding conversations, and review the selected context. Raw media or encoded content in a locally retained archive is not certified secret-free; full archive attachment is an explicit disclosure decision.

ThreadShift does not deliberately serialize the parent environment or copy native authentication stores into the bundle. Native subprocesses inherit their environment and keep using their own configured credentials for authentication. OpenCode's provider, network behavior, file reads and subsequent tool actions are governed by OpenCode's configuration and permissions. Attachment sanitization does not sandbox those actions or make a remote provider local.

Exports created by older builds are not modified retroactively. Re-import them to produce sanitized outputs. Review or delete old copies separately before sharing; the original security-scan report remains a historical record of the pre-fix revision.
