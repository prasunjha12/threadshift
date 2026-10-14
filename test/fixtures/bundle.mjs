export function validBundle() {
  const event = {
    id: "event-1",
    order: 0,
    kind: "user",
    sourceId: "item-1",
    timestamp: "2026-10-13T00:00:00.000Z",
    text: "Fix the parser",
    rawRecordIds: ["raw-1"],
  };
  return {
    manifest: {
      schemaVersion: 1,
      bundleId: "bundle-1",
      capturedAt: "2026-10-13T00:00:00.000Z",
      completeness: "complete",
      counts: { events: 1, rawRecords: 1 },
      exclusions: [],
      sourceDigest: "sha256:source",
      workspaceDigest: "sha256:workspace",
    },
    source: {
      harness: "codex",
      runtimeVersion: "0.162.1",
      sessionId: "session-1",
      captureMechanism: "app-server-thread-read",
      workingDirectory: "C:/project",
    },
    history: {
      events: [event],
      rawRecords: [{ id: "raw-1", value: { type: "userMessage", text: "Fix the parser" }, sourceLocator: "turn-1/item-1" }],
    },
    workspace: {
      root: "C:/project",
      inspectedAt: "2026-10-13T00:00:00.000Z",
      digest: "sha256:workspace",
      changedFiles: [],
      instructionReferences: [],
      artifactReferences: [],
    },
    git: { present: false, head: null, branch: null, status: [], patches: [], warnings: [] },
    handoff: {
      objective: { value: "Fix the parser", origin: "source-stated", eventIds: ["event-1"] },
      latestRequest: { value: "Fix the parser", origin: "source-stated", eventIds: ["event-1"] },
      currentState: null,
      completed: [], decisions: [], remaining: [], blockers: [], nextActions: [], importantFiles: [], verificationState: [], activePlan: [],
    },
    configuration: { references: [], compatibility: "not-translated" },
    artifacts: { references: [] },
    provenance: [],
    warnings: [],
  };
}
