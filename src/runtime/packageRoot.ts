import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PACKAGE_NAME = "@dailephd/my-dev-kit-lab";

/**
 * Walks upward from the executing module's location (not process.cwd()) until it
 * finds the package.json that declares PACKAGE_NAME, so this resolves correctly
 * from a source checkout, compiled dist output, or an installed node_modules copy.
 */
export function discoverPackageRoot(startDir?: string): string {
  const start = path.resolve(startDir ?? path.dirname(fileURLToPath(import.meta.url)));
  let current = start;
  while (true) {
    const candidatePackageJson = path.join(current, "package.json");
    if (existsSync(candidatePackageJson)) {
      const name = readPackageName(candidatePackageJson);
      if (name === PACKAGE_NAME) {
        return current;
      }
    }
    const parent = path.dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }
  throw new Error(
    `Unable to locate the "${PACKAGE_NAME}" package root by walking up from ${start}.`
  );
}

function readPackageName(packageJsonPath: string): string | undefined {
  try {
    const parsed = JSON.parse(readFileSync(packageJsonPath, "utf8")) as { name?: unknown };
    return typeof parsed.name === "string" ? parsed.name : undefined;
  } catch {
    return undefined;
  }
}
