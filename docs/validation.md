# Validation evidence

Checked 2026-10-14. This is an early implementation preview, not release certification.

| Gate | Windows local | macOS | Linux |
| --- | --- | --- | --- |
| Node 24.12.0 build/typecheck | Pass | Not run | Not run |
| Runtime/core/source/workspace/context/CLI/privacy fixtures | 75 checked passes, 1 sandbox-blocked alias test skipped | Not run | Not run |
| Complete fixture handoff | Pass | Not run | Not run |
| Offline tarball consumer installation | Pass | Not run | Not run |
| Native paused-source record/count comparison | Pass for one fresh, small session | Not run | Not run |
| Native OpenCode model continuation | Fresh post-fix task passed without clarification; process remains open | Not run | Not run |

The workflow contains all three real OS runners; the workflow had not executed at the time of these local checks. macOS/Linux runner access is unavailable in this local Windows session. The user explicitly authorized a real dummy Codex session and OpenCode handover; both installed tools performed inference using their available authentication/provider setup.

## Windows native run, 2026-10-13

Created Codex session `[local test identity omitted]` with CLI 0.162.1 in a tiny Git repository whose path contains spaces and Unicode. Its completed turn contains four persisted items. Independent native turn-page item locators match all four exported item records exactly; with thread and turn metadata the bundle contains six safe raw records. A separate native capture produced the same source digest. Private reasoning fields remain excluded.

This run exposed two fixture blind spots, corrected with failing-then-passing regressions: native `thread/turns/list` uses an array-valued `data`, and the Windows OpenCode npm PowerShell shim invokes an executable beneath `node_modules` directly. All source fixtures now reproduce the native array page shape.

The source Codex process could infer but its shell commands were rejected by policy. The destination OpenCode 2.0.22 session `[local test identity omitted]` received the prepared attachments, read `sum.js` and its tests, and reproduced the empty-array failure. The source prompt's no-edit instruction initially caused it to stop after proposing the fix. After explicitly clarifying that the restriction applied only to source inspection, the same destination session added the zero accumulator, passed both tests, and quoted bundle `[local test identity omitted]`. The outer validation independently reran both tests successfully.

This verifies a real transferred context and destination continuation, with a clarification step. It does not certify an unattended one-shot launch: native OpenCode emitted responses but stayed open, and the first bounded launch timed out without clean process completion. Windows descendant cleanup remains unverified. The source had no persisted executed tool history, so this small session cannot establish the historical-command no-replay acceptance gate. Larger source histories, dry-run store auditing, cancellation, macOS, and Linux native gates remain pending. Real histories and provider credentials are not committed.

## Windows native retest after privacy fixes, 2026-10-14

Tested revision `11446fc` using a fresh Codex CLI 0.162.1 session `[local test identity omitted]` and native OpenCode 2.0.22 session `[local test identity omitted]` with its real configured provider. An independent native source query matched both item locators exactly: one turn, two items and four safe raw records. Dry run and package preparation succeeded. The prepared launch instructions attached only the selected continuation context, preserving the full archive locally.

The destination completed the task on its first launch, without a clarification prompt: it read `sum.js` and the existing tests, added the zero accumulator, ran `npm test` with three passes and zero failures, and quoted bundle `[local test identity omitted]`. An independent rerun also passed all three tests. The initial independent baseline had two passes and one empty-array failure. The workspace path contained spaces and Unicode.

Synthetic key and confidential `.env` body sentinels were absent from the bundle, continuation and observed destination events. The confidential change retained status metadata only, without a content hash or patch. Observed destination tools did not read `.env`, and its content remained unchanged. These assertions concern the known synthetic test values, not arbitrary-secret detection or restrictions on future destination file access.

OpenCode remained open after its final response. This verifies real model/task continuation on the fixed revision; the automatic process-exit gate remains uncertified. The exact prepared launch instructions were executed directly with streaming output capture. No termination was attempted. The source turn contained no executed historical tool commands, so the general no-replay gate remains pending. Evidence is kept outside the repository in the dated native-handoff-retest output folder; real histories and provider configuration are not committed.

## Privacy fixes, 2026-10-14

The scoped security review found text-credential redaction gaps, import bypass of sanitization, and identifier-controlled default-output traversal. The patch adds shared schema-aware sanitization for capture/import/context/persistence, private-reasoning and linked-copy exclusions, secret-file/project-policy exclusions before hashing or diff reads, portable identifier validation and default-output containment. OpenCode now receives only selected context unless `--attach-bundle` explicitly includes the full sanitized local archive.

Synthetic regression cases failed before each correction and now pass. The independent candidate review also exposed short Authorization values, forged redaction prefixes, event-linked warning copies, nested/private reasoning copies, stale precompiled context, repeated-warning growth and ordinary README patch digest mismatch; their regression cases now pass. Public token-usage metadata and safe unknown raw records remain intact.

Final `npm test` passed 73 cases and skipped the existing Windows sandbox-blocked alias case. Two additional imported/actual-Git rename cases were then added; the entire privacy suite passed 15/15, bringing checked current cases to 75 passes. Build, typecheck and offline tarball consumer installation passed. No new model inference, external service access or actual credentials were used for the security fixes themselves. The subsequent native retest above verified the changed context-only attachment default with a live provider. Native process completion and actual macOS/Linux checks remain separate release gates.

These results prove the reproduced paths are blocked. They do not certify that arbitrary prose, media or unknown encodings contain no confidential information. See [privacy controls and limits](privacy.md). Older exports and the pre-fix scan report remain unchanged.

## What the fixtures prove

Pinned synthetic Codex 0.162.1 protocol responses are read without resume or turn creation, paginated twice, validated, safely normalized and preserved. Synthetic OpenCode 2.0.22 receives literal attachment paths in the selected workspace and returns a session identity. Tests cover a seeded failing parser test, explicit decision/remaining work, unchanged canonical import, unknown records, disclosed reasoning exclusions, launch errors, cancellation, package retention and workspace mismatch.

These are subprocess fixtures, not a fixture provider running inside native OpenCode. They do not establish actual model understanding, provider compatibility or native source preservation. No historical commands are executed by ThreadShift; the acceptance harness deliberately runs its own seeded test separately.

The final review identified and the implementation corrected physical-output alias protection, repository-subfolder path resolution, supplied-field credential redaction and process-tree cancellation. Local regressions also cover existing-home-only capture and npm wrappers with colocated Node. The physical junction/symlink regression is skipped in this Windows sandbox because creation returns EPERM; CI must execute it and treats that inability as a failure. The direct persistence boundary tests run locally. POSIX termination/escalation remains unverified until the actual macOS/Linux runs.

Windows tree-termination probe in this sandbox returned taskkill exit 1 with "The user name or password is incorrect." The fallback force-killed the root, and local fixture PIDs were gone, but native Windows process-tree termination is not certified. Cancellation/timeout keeps its stable error code and discloses unverified descendant cleanup when the OS rejects termination.

## Native acceptance procedure

Use a tiny isolated Git repository and separate Codex/OpenCode configuration/data homes. On each actual OS, install exactly Codex CLI 0.162.1 and OpenCode 2.0.22 and record OS, Node and Git versions.

1. In Codex, create a task with a failing regression test, a changed file, an explicit decision and a remaining task. Stop at a completed turn. A model-backed setup requires separately authorized provider usage.
2. Record the session ID and an independently counted safe readable record inventory. Run the export twice into different files. Compare source record IDs/counts with exported raw records, normalized event links, exclusions and source digest. Do not infer preservation from normalized event count alone.
3. Run dry run and snapshot the source/workspace/destination stores before and after, distinguishing runtime housekeeping from any ThreadShift output. Assert no new turn or inference.
4. Prepare files, inspect continuation.md and report.json, then explicitly launch with an authorized real provider or native local fixture provider. Record which was used.
5. Verify the actual destination response names the objective, exact changed file, decision and remaining work, cites the attached bundle, and does not replay historical commands. Record the destination session ID and failure/cancellation behavior. Session identity alone is insufficient.
6. Save dated evidence per platform: versions, source identity, safe raw/event counts, source/workspace digests, selected context counts, destination session ID, provider category and pass/fail. Keep real histories and credentials out of Git.

All three native checks and CI runs must pass before changing support claims.

`node scripts/native-acceptance.mjs --help` describes the opt-in collector. It prepares a real selected session and records versions, identities, digests and counts. Only explicit `--launch --provider-kind real|native-local-fixture` starts inference. It always leaves independent source-count and response/no-replay audits pending; it cannot certify them from a process exit code.

## Reviewed CI action revisions

The immutable revisions were checked against the upstream release commits: [checkout v4.2.2](https://github.com/actions/checkout/commit/11bd71901bbe5b1630ceea73d27597364c9af683), [setup-node v4.4.0](https://github.com/actions/setup-node/commit/49933ea5288caeca8642d1e84afbd3f7d6820020). The workflow uses read-only repository permissions and disables persisted checkout credentials.
