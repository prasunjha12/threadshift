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

For OpenCode sources, recognized reasoning fields and provider-private state are excluded before canonical persistence, including linked event/provenance copies. Inline attachment bytes are excluded; safe reference metadata may remain and ThreadShift does not fetch remote attachments. Safe unknown raw metadata is retained, so novel private encodings remain a review responsibility. The private source helper's generated authentication value exists only in memory and its child environment; it is not provider authentication.

Codex destination input is regenerated from persisted sanitized continuation files, sent through stdin rather than process arguments. The complete archive is sent only with `--attach-bundle`. Normal destination workspace access still applies independently of export filtering.

## Pi archive and effective context

Pi schema-3 bundles retain only selected branch ancestry. Smart context is rebuilt from sanitized canonical records at every compilation/persistence boundary, applying the latest retained context edits and compaction range. Edited/compacted originals remain in the local archive but do not reappear through cached request/state fields. Explicit unlinked user-supplied handoff fields remain attributed to the user.

Known Pi thinking blocks/signatures, provider signatures/state, inline media bytes, opaque custom state and source system sections/tool declarations are excluded at the shared boundary, including linked copies. Safe visible text remains. Source system prompts do not become destination instructions. Unknown metadata and arbitrary prose still require review. `--attach-bundle` explicitly sends sanitized originals, including messages omitted or replaced in effective context; this is broader disclosure than the default continuation.
