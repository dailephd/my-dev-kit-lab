// Lab-owned tutorial browser fixture: prepare step.
//
// Copies the static demo app into the run-owned disposable target root and
// writes a small JSON artifact that file/JSON assertions can check. Node
// built-ins only -- this fixture belongs to my-dev-kit-lab's own tests and must
// never require a sibling product checkout or a framework.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const contractRoot = path.dirname(fileURLToPath(import.meta.url));
const targetRoot = process.argv[2];

if (!targetRoot) {
  console.error("prepare requires a target root argument");
  process.exit(2);
}

fs.mkdirSync(path.join(targetRoot, "app"), { recursive: true });
fs.mkdirSync(path.join(targetRoot, "out"), { recursive: true });

for (const file of ["index.html", "server.mjs"]) {
  fs.copyFileSync(path.join(contractRoot, file), path.join(targetRoot, "app", file));
}

fs.writeFileSync(
  path.join(targetRoot, "out", "report.json"),
  JSON.stringify({ prepared: true, counts: { widgets: 3 } }, null, 2),
  "utf8"
);

console.log("prepared tutorial browser fixture at " + targetRoot);
