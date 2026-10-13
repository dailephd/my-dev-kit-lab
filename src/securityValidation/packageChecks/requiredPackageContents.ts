import fs from "node:fs/promises";
import path from "node:path";
import type { SecurityFinding } from "../types.js";

export const REQUIRED_PACKAGE_CONTENTS = [
  "CHANGELOG.md",
  "LICENSE",
  "README.md",
  "package.json",
  // Public bin target (installed CLI router entrypoint).
  "dist/scripts/cli.js",
  // Legacy final-demo bin-target compatibility (pre-v0.4.6 package.json bin).
  "dist/scripts/run-final-demo.js",
  // Compiled runtime the installed CLI router and its shared command owners
  // depend on.
  "dist/src/index.js",
  "dist/src/cli/runLabCli.js",
  "dist/src/runtime/labExecutionContext.js",
  "dist/src/runtime/packageRoot.js",
  "dist/src/runtime/packageResource.js",
  // Bundled runtime resources public installed commands read by default
  // (experiment run/controlled, demo final, legacy final-demo invocation).
  "benchmarks/contracts/benchmark-project-profiles.json",
  "examples/token-savings-cases.json",
] as const;

function normalizeTarballPath(file: string): string {
  const normalized = file.replace(/\\/g, "/").replace(/^(\.\/)+/, "");
  return normalized.startsWith("package/")
    ? normalized.slice("package/".length)
    : normalized;
}

// Policy belongs beside the existing required-file detector. Identity is
// supplied by the existing target resolver, never inferred from package name.
export async function requiredContentsForTarget(target: {
  targetRoot: string;
  isSelf: boolean;
}): Promise<{ requiredFiles: readonly string[]; findings: SecurityFinding[] }> {
  const required = new Set<string>(target.isSelf ? REQUIRED_PACKAGE_CONTENTS : ["package.json"]);
  const findings: SecurityFinding[] = [];
  function invalid(field: string, reason: string): void {
    findings.push({
      id: `npm-pack-metadata-${findings.length}`,
      title: `Package metadata cannot be validated: ${field}`,
      severity: "blocker",
      category: "package-content",
      description: reason,
      evidence: `package.json field: ${field}; ${reason}`,
      affectedFiles: ["package.json"],
      recommendation: "Provide readable package metadata with supported, safe package-relative entrypoint paths and rerun validation.",
      releaseImpact: "Blocker: required package evidence is incomplete",
    });
  }
  function entry(value: unknown, field: string, exportsPath = false): void {
    if (typeof value !== "string") {
      invalid(field, "Malformed entrypoint: expected a nonempty string.");
      return;
    }
    const normalized = value.replace(/\\/g, "/");
    const relative = normalized.replace(/^(\.\/)+/, "");
    if (!relative || normalized !== normalized.trim() ||
        /[\x00-\x1f\x7f:*?#%]/.test(normalized) || normalized.startsWith("/") ||
        relative.split("/").some((part) => !part || part === ".." || part === "." || part === "node_modules") ||
        (exportsPath && !normalized.startsWith("./"))) {
      invalid(field, "Unsafe or unsupported entrypoint path (absolute, escaping, pattern, URL, or ambiguous path).");
      return;
    }
    required.add(relative);
  }
  try {
    const metadata: unknown = JSON.parse(await fs.readFile(path.join(target.targetRoot, "package.json"), "utf8"));
    if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
      invalid("package.json", "Malformed package metadata: expected an object.");
    } else if (!target.isSelf) {
      const pkg = metadata as Record<string, unknown>;
      if ("bin" in pkg) {
        if (typeof pkg.bin === "string") entry(pkg.bin, "bin");
        else if (pkg.bin && typeof pkg.bin === "object" && !Array.isArray(pkg.bin)) {
          for (const key of Object.keys(pkg.bin).sort()) {
            if (!key || key === "." || key === ".." || /[\\/:\x00-\x1f\x7f]/.test(key)) {
              invalid("bin", "Unsafe or unsupported executable name in bin map.");
            } else entry((pkg.bin as Record<string, unknown>)[key], `bin.${key}`);
          }
        } else invalid("bin", "Malformed bin: expected a string or object map.");
      }
      if ("main" in pkg) {
        if (typeof pkg.main === "string" && pkg.main && !path.posix.extname(pkg.main.replace(/\\/g, "/"))) {
          invalid("main", "Unsupported or ambiguous main: extensionless or directory resolution is not validated; declare an exact runtime file.");
        } else entry(pkg.main, "main");
      }
      if ("exports" in pkg && pkg.exports !== null) {
        if (typeof pkg.exports === "string") entry(pkg.exports, "exports", true);
        else if (pkg.exports && typeof pkg.exports === "object" && !Array.isArray(pkg.exports)) {
          const exports = pkg.exports as Record<string, unknown>;
          const keys = Object.keys(exports).sort();
          if (!keys.length || keys.some((key) => key !== "." && (
            !key.startsWith("./") || /[\\:*?#%\x00-\x1f\x7f]/.test(key) ||
            key.slice(2).split("/").some((part) => !part || part === "." || part === "..")
          ))) {
            invalid("exports", "Unsupported or ambiguous exports: conditional or pattern mappings require additional evidence.");
          } else for (const key of keys) {
            if (exports[key] === null) continue; // Explicitly excluded subpath.
            if (typeof exports[key] !== "string") {
              invalid(`exports.${key}`, "Unsupported exports shape: conditional objects and fallback arrays are not validated.");
            } else entry(exports[key], `exports.${key}`, true);
          }
        } else invalid("exports", "Unsupported exports shape: expected an exact string or subpath map.");
      }
      // npm automatically ships existing root README and license files. Do not
      // invent a documentation requirement for packages without those files.
      for (const file of (await fs.readdir(target.targetRoot, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
        if (file.isFile() && /^(readme|licen[cs]e)(\..*)?$/i.test(file.name)) required.add(file.name);
      }
    }
  } catch {
    invalid("package.json", "Package metadata is missing, unreadable, or unparseable.");
  }
  return { requiredFiles: [...required].sort(), findings };
}

export function detectMissingRequiredContents(options: {
  files: string[];
  requiredFiles?: readonly string[];
  checkId: string;
}): { missing: string[]; findings: SecurityFinding[] } {
  const present = new Set(options.files.map(normalizeTarballPath));
  const required = [...(options.requiredFiles ?? REQUIRED_PACKAGE_CONTENTS)]
    // Requirements are package-relative declarations, not archive paths. A
    // literal package/ directory in an entrypoint must not be stripped.
    .map((file) => file.replace(/\\/g, "/").replace(/^(\.\/)+/, ""))
    .sort((left, right) => left.localeCompare(right));
  const missing = required.filter((file) => !present.has(file));

  const findings = missing.map((file, index): SecurityFinding => ({
    id: `${options.checkId}-required-missing-${index}`,
    title: `Required file missing from npm tarball: package/${file}`,
    severity: "blocker",
    category: "package-content",
    description: `The required release file 'package/${file}' is absent from the npm package inventory`,
    evidence: `Missing required path: package/${file}`,
    affectedFiles: [file],
    recommendation: `Include '${file}' in the package files allowlist or restore the expected build output`,
    releaseImpact: "Blocker: the npm package is incomplete and must not be published",
  }));

  return { missing, findings };
}
