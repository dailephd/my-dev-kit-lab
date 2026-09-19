import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const sourceRoot = path.dirname(fileURLToPath(import.meta.url));
const targetRoot = process.argv[2];
if (!targetRoot) {
  console.error("prepare requires a target root argument");
  process.exit(2);
}
fs.mkdirSync(path.join(targetRoot, "app"), { recursive: true });
fs.mkdirSync(path.join(targetRoot, "out"), { recursive: true });
for (const file of ["index.html", "server.mjs"]) fs.copyFileSync(path.join(sourceRoot, file), path.join(targetRoot, "app", file));
fs.writeFileSync(path.join(targetRoot, "out", "report.json"), JSON.stringify({ prepared: true, counts: { widgets: 3 } }, null, 2), "utf8");