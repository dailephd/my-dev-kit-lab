import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { scanProjectInventory } from "../../src/audits/core/projectInventory.js";

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "inventory-test-"));
}

function cleanup(...dirs: string[]): void {
  for (const d of dirs) {
    try {
      fs.rmSync(d, { recursive: true, force: true });
    } catch {
      // best-effort
    }
  }
}

function writeFile(root: string, relativePath: string, content = ""): void {
  const fullPath = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, content, "utf8");
}

// Builds a small, deterministic fixture project covering every category and
// exclusion rule under test.
function buildFixtureProject(): string {
  const root = makeTempDir();

  writeFile(root, "package.json", JSON.stringify({ name: "fixture", version: "1.0.0" }));
  writeFile(root, "package-lock.json", JSON.stringify({ name: "fixture", version: "1.0.0", lockfileVersion: 3 }));
  writeFile(root, "README.md", "# Fixture Project\n\nSome docs.\n");
  writeFile(root, "docs/GUIDE.md", "# Guide\n");
  writeFile(root, "src/index.ts", "export const x = 1;\nexport const y = 2;\n");
  writeFile(root, "src/util.ts", "export function util() {}\n");
  writeFile(root, "tests/index.test.ts", "import {} from 'vitest';\n");
  writeFile(root, "scripts/build.ts", "console.log('build');\n");
  writeFile(root, "tsconfig.json", "{}");
  writeFile(root, ".github/workflows/ci.yml", "name: CI\n");
  writeFile(root, "unknown-data.bin", "\x00\x01\x02binarydata");

  // Excluded directories -- must never appear in the scanned output.
  writeFile(root, "node_modules/some-package/index.js", "module.exports = {};\n");
  writeFile(root, ".git/HEAD", "ref: refs/heads/main\n");
  writeFile(root, "dist/index.js", "module.exports = {};\n");
  writeFile(root, "build/output.js", "// built\n");
  writeFile(root, "coverage/lcov.info", "TN:\n");
  writeFile(root, "reports/security/report.json", "{}");
  writeFile(root, "lab-output/artifact.json", "{}");
  writeFile(root, ".my-dev-kit/index.json", "{}");

  return root;
}

describe("scanProjectInventory — fixture project classification", () => {
  it("classifies source files", () => {
    const root = buildFixtureProject();
    try {
      const inventory = scanProjectInventory(root);
      const sourcePaths = inventory.sourceFiles.map((f) => f.relativePath);
      expect(sourcePaths).toContain("src/index.ts");
      expect(sourcePaths).toContain("src/util.ts");
    } finally {
      cleanup(root);
    }
  });

  it("classifies test files", () => {
    const root = buildFixtureProject();
    try {
      const inventory = scanProjectInventory(root);
      expect(inventory.testFiles.map((f) => f.relativePath)).toContain("tests/index.test.ts");
    } finally {
      cleanup(root);
    }
  });

  it("classifies docs files", () => {
    const root = buildFixtureProject();
    try {
      const inventory = scanProjectInventory(root);
      const docsPaths = inventory.docsFiles.map((f) => f.relativePath);
      expect(docsPaths).toContain("README.md");
      expect(docsPaths).toContain("docs/GUIDE.md");
    } finally {
      cleanup(root);
    }
  });

  it("classifies package/config files", () => {
    const root = buildFixtureProject();
    try {
      const inventory = scanProjectInventory(root);
      const packagePaths = inventory.packageFiles.map((f) => f.relativePath);
      expect(packagePaths).toContain("package.json");
      expect(packagePaths).toContain("package-lock.json");
      const configEntry = inventory.files.find((f) => f.relativePath === "tsconfig.json");
      expect(configEntry?.category).toBe("config");
    } finally {
      cleanup(root);
    }
  });

  it("classifies script files", () => {
    const root = buildFixtureProject();
    try {
      const inventory = scanProjectInventory(root);
      expect(inventory.scriptFiles.map((f) => f.relativePath)).toContain("scripts/build.ts");
    } finally {
      cleanup(root);
    }
  });

  it("classifies CI workflow files", () => {
    const root = buildFixtureProject();
    try {
      const inventory = scanProjectInventory(root);
      expect(inventory.ciFiles.map((f) => f.relativePath)).toContain(".github/workflows/ci.yml");
    } finally {
      cleanup(root);
    }
  });
});

describe("scanProjectInventory — exclusions", () => {
  it("excludes node_modules", () => {
    const root = buildFixtureProject();
    try {
      const inventory = scanProjectInventory(root);
      expect(inventory.files.some((f) => f.relativePath.startsWith("node_modules/"))).toBe(false);
    } finally {
      cleanup(root);
    }
  });

  it("excludes .git", () => {
    const root = buildFixtureProject();
    try {
      const inventory = scanProjectInventory(root);
      expect(inventory.files.some((f) => f.relativePath.startsWith(".git/"))).toBe(false);
    } finally {
      cleanup(root);
    }
  });

  it("excludes dist, build, and coverage", () => {
    const root = buildFixtureProject();
    try {
      const inventory = scanProjectInventory(root);
      expect(inventory.files.some((f) => f.relativePath.startsWith("dist/"))).toBe(false);
      expect(inventory.files.some((f) => f.relativePath.startsWith("build/"))).toBe(false);
      expect(inventory.files.some((f) => f.relativePath.startsWith("coverage/"))).toBe(false);
    } finally {
      cleanup(root);
    }
  });

  it("excludes reports, lab-output, and .my-dev-kit", () => {
    const root = buildFixtureProject();
    try {
      const inventory = scanProjectInventory(root);
      expect(inventory.files.some((f) => f.relativePath.startsWith("reports/"))).toBe(false);
      expect(inventory.files.some((f) => f.relativePath.startsWith("lab-output/"))).toBe(false);
      expect(inventory.files.some((f) => f.relativePath.startsWith(".my-dev-kit/"))).toBe(false);
    } finally {
      cleanup(root);
    }
  });

  it("records excluded directory occurrences in the summary", () => {
    const root = buildFixtureProject();
    try {
      const inventory = scanProjectInventory(root);
      const names = inventory.excludedDirectorySummary.map((e) => e.name);
      expect(names).toContain("node_modules");
      expect(names).toContain(".git");
    } finally {
      cleanup(root);
    }
  });
});

describe("scanProjectInventory — Windows/paths-with-spaces support", () => {
  it("handles a directory and file path with spaces", () => {
    const root = makeTempDir();
    try {
      writeFile(root, "src dir/my file.ts", "export const x = 1;\n");
      const inventory = scanProjectInventory(root);
      expect(inventory.files.map((f) => f.relativePath)).toContain("src dir/my file.ts");
    } finally {
      cleanup(root);
    }
  });

  it("normalizes path separators to forward slashes regardless of platform", () => {
    const root = makeTempDir();
    try {
      writeFile(root, path.join("a", "b", "c.ts"), "export const x = 1;\n");
      const inventory = scanProjectInventory(root);
      const entry = inventory.files.find((f) => f.relativePath.endsWith("c.ts"));
      expect(entry?.relativePath).toBe("a/b/c.ts");
      expect(entry?.relativePath).not.toContain("\\");
    } finally {
      cleanup(root);
    }
  });
});

describe("scanProjectInventory — determinism", () => {
  it("returns files in stable, sorted order across repeated scans", () => {
    const root = buildFixtureProject();
    try {
      const first = scanProjectInventory(root);
      const second = scanProjectInventory(root);
      expect(first.files.map((f) => f.relativePath)).toEqual(second.files.map((f) => f.relativePath));
      const sorted = [...first.files.map((f) => f.relativePath)].sort((a, b) => a.localeCompare(b));
      expect(first.files.map((f) => f.relativePath)).toEqual(sorted);
    } finally {
      cleanup(root);
    }
  });

  it("category counts are stable across repeated scans", () => {
    const root = buildFixtureProject();
    try {
      const first = scanProjectInventory(root);
      const second = scanProjectInventory(root);
      expect(first.filesByCategory).toEqual(second.filesByCategory);
    } finally {
      cleanup(root);
    }
  });
});

describe("scanProjectInventory — binary and large-file bounding", () => {
  it("does not compute a line count for a binary file", () => {
    const root = buildFixtureProject();
    try {
      const inventory = scanProjectInventory(root);
      const binaryEntry = inventory.files.find((f) => f.relativePath === "unknown-data.bin");
      expect(binaryEntry?.lineCount).toBeUndefined();
    } finally {
      cleanup(root);
    }
  });

  it("skips entirely a file at or above the hard skip size", () => {
    const root = makeTempDir();
    try {
      writeFile(root, "huge.txt", "x".repeat(1000));
      const inventory = scanProjectInventory(root, { hardSkipFileBytes: 500 });
      expect(inventory.files.some((f) => f.relativePath === "huge.txt")).toBe(false);
      expect(inventory.skippedFileCount).toBe(1);
      expect(inventory.warnings.some((w) => w.includes("oversized"))).toBe(true);
    } finally {
      cleanup(root);
    }
  });

  it("does not compute a line count for a file above the line-count size bound but still inventories it", () => {
    const root = makeTempDir();
    try {
      writeFile(root, "src/big.ts", "x".repeat(1000));
      const inventory = scanProjectInventory(root, { maxFileBytesForLineCount: 500 });
      const entry = inventory.files.find((f) => f.relativePath === "src/big.ts");
      expect(entry).toBeDefined();
      expect(entry?.lineCount).toBeUndefined();
    } finally {
      cleanup(root);
    }
  });
});

describe("scanProjectInventory — does not write target files", () => {
  it("target directory contents are unchanged after a scan", () => {
    const root = buildFixtureProject();
    try {
      const before = JSON.stringify(walkAll(root));
      scanProjectInventory(root);
      const after = JSON.stringify(walkAll(root));
      expect(after).toBe(before);
    } finally {
      cleanup(root);
    }
  });
});

function walkAll(dir: string): string[] {
  const result: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      result.push(...walkAll(full));
    } else {
      result.push(full);
    }
  }
  return result.sort();
}
