import { appendFile, writeFile } from "node:fs/promises";

if (process.argv.includes("--version")) {
  process.stdout.write("opencode 2.0.22\n");
  process.exit(0);
}

if (process.env.OPENCODE_FIXTURE_MODE === "delay") {
  if (process.env.OPENCODE_PID_FILE) await writeFile(process.env.OPENCODE_PID_FILE, String(process.pid));
  await new Promise((resolve) => setTimeout(resolve, 30_000));
}

if (process.env.OPENCODE_TEST_LOG) {
  await appendFile(process.env.OPENCODE_TEST_LOG, `${JSON.stringify({ argv: process.argv.slice(2), cwd: process.cwd() })}\n`);
}

if (process.env.OPENCODE_FIXTURE_MODE === "fail") {
  process.stderr.write("fixture launch failed\n");
  process.exit(2);
}

process.stdout.write(`${JSON.stringify({ type: "text", sessionID: "ses_fixture", part: { type: "text", text: "Continuation ready." } })}\n`);
if (process.env.OPENCODE_FIXTURE_MODE === "error-event") {
  process.stdout.write(`${JSON.stringify({ type: "error", sessionID: "ses_fixture", error: { message: "provider failed" } })}\n`);
  process.exit(0);
}
process.stdout.write(`${JSON.stringify({ type: "step_finish", sessionID: "ses_fixture", part: { type: "step-finish", reason: "stop" } })}\n`);
