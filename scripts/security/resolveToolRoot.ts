import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export function resolveToolRoot(moduleUrl: string): string {
  let current = path.dirname(fileURLToPath(moduleUrl));

  while (true) {
    if (fs.existsSync(path.join(current, "package.json"))) {
      return current;
    }

    const parent = path.dirname(current);
    if (parent === current) {
      return process.cwd();
    }
    current = parent;
  }
}
