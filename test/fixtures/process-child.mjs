import { spawn } from "node:child_process";
import { writeFile } from "node:fs/promises";
const [mode, ...args] = process.argv.slice(2);

if (mode === "args") {
  process.stdout.write(JSON.stringify(args));
} else if (mode === "sleep") {
  setTimeout(() => process.stdout.write("finished"), 30_000);
} else if (mode === "exit") {
  process.stderr.write("fixture failure");
  process.exit(Number(args[0] ?? 1));
} else if (mode === "tree") {
  process.on("SIGTERM", () => {});
  const child = spawn(process.execPath, ["-e", 'setInterval(() => {}, 1000)'], { stdio: "ignore", windowsHide: true });
  await writeFile(args[0], JSON.stringify([process.pid, child.pid]));
  setInterval(() => {}, 1000);
} else {
  process.exit(2);
}
