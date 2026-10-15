import { spawn } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
const [mode, ...args] = process.argv.slice(2);

if (mode === "stdin-hash") {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  const bytes = Buffer.concat(chunks);
  console.log(JSON.stringify({ bytes: bytes.length, hash: createHash("sha256").update(bytes).digest("hex") }));
} else if (mode === "stdin-close") {
  process.stdin.destroy(); setTimeout(() => process.exit(0), 20);
} else if (mode === "stdin-wait") {
  process.stdin.pause(); setInterval(() => {}, 1000);
} else if (mode === "args") {
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
