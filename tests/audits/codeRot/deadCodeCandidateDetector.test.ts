import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { scanProjectInventory } from "../../../src/audits/core/projectInventory.js";
import { collectSourceOfTruth } from "../../../src/audits/core/sourceOfTruth.js";
import { resolveAuditTarget } from "../../../src/audits/core/auditTarget.js";
import { normalizeAuditConfig } from "../../../src/audits/core/auditConfig.js";
import { DEAD_CODE_CANDIDATE_DETECTOR } from "../../../src/audits/codeRot/detectors/deadCodeCandidateDetector.js";
import type { AuditDetectorContext } from "../../../src/audits/core/auditRegistry.js";

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "dead-code-test-"));
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

function buildContext(root: string): AuditDetectorContext {
  const inventory = scanProjectInventory(root);
  const sourceOfTruth = collectSourceOfTruth(root, inventory);
  const target = resolveAuditTarget(undefined, root);
  const config = normalizeAuditConfig({ include: "docs,tests,package,architecture,cli" }, root);
  return { target, config, inventory, sourceOfTruth };
}

async function run(root: string) {
  const ctx = buildContext(root);
  return DEAD_CODE_CANDIDATE_DETECTOR.run(ctx);
}

describe("DEAD_CODE_CANDIDATE_DETECTOR — unreferenced scripts/ files", () => {
  it("flags a scripts/ file not referenced by any package.json script", async () => {
    const root = makeTempDir();
    try {
      writeFile(root, "package.json", JSON.stringify({ name: "fixture", version: "1.0.0", scripts: { build: "tsc" } }));
      writeFile(root, "scripts/orphan.ts", "export {};\n");
      const issues = await run(root);
      expect(issues.some((i) => i.title.includes('scripts/orphan.ts" is not referenced'))).toBe(true);
    } finally {
      cleanup(root);
    }
  });

  it("does not flag a scripts/ file referenced by a package.json script", async () => {
    const root = makeTempDir();
    try {
      writeFile(root, "package.json", JSON.stringify({ name: "fixture", version: "1.0.0", scripts: { thing: "tsx scripts/thing.ts" } }));
      writeFile(root, "scripts/thing.ts", "export {};\n");
      const issues = await run(root);
      expect(issues.some((i) => i.title.includes('scripts/thing.ts" is not referenced'))).toBe(false);
    } finally {
      cleanup(root);
    }
  });

  it("does not flag a scripts/ helper file imported by another script", async () => {
    const root = makeTempDir();
    try {
      writeFile(root, "package.json", JSON.stringify({ name: "fixture", version: "1.0.0", scripts: { thing: "tsx scripts/thing.ts" } }));
      writeFile(root, "scripts/thing.ts", 'import { helper } from "./helper.js";\nhelper();\n');
      writeFile(root, "scripts/helper.ts", "export function helper() {}\n");
      const issues = await run(root);
      expect(issues.some((i) => i.title.includes('scripts/helper.ts" is not referenced'))).toBe(false);
    } finally {
      cleanup(root);
    }
  });
});

describe("DEAD_CODE_CANDIDATE_DETECTOR — unreferenced source files", () => {
  it("flags a source file with no in-repo importer", async () => {
    const root = makeTempDir();
    try {
      writeFile(root, "package.json", JSON.stringify({ name: "fixture", version: "1.0.0", scripts: {} }));
      writeFile(root, "src/orphanModule.ts", "export const x = 1;\n");
      const issues = await run(root);
      expect(issues.some((i) => i.title.includes("orphanModule.ts"))).toBe(true);
    } finally {
      cleanup(root);
    }
  });

  it("does not flag a source file imported by another source file", async () => {
    const root = makeTempDir();
    try {
      writeFile(root, "package.json", JSON.stringify({ name: "fixture", version: "1.0.0", scripts: {} }));
      writeFile(root, "src/main.ts", 'import { helper } from "./helper.js";\nhelper();\n');
      writeFile(root, "src/helper.ts", "export function helper() {}\n");
      const issues = await run(root);
      expect(issues.some((i) => i.title.includes("helper.ts"))).toBe(false);
    } finally {
      cleanup(root);
    }
  });

  it("does not flag files under benchmarks/ or examples/ (fixture/example content, not part of the import graph)", async () => {
    const root = makeTempDir();
    try {
      writeFile(root, "package.json", JSON.stringify({ name: "fixture", version: "1.0.0", scripts: {} }));
      writeFile(root, "benchmarks/projects/todo/src/service.ts", "export const x = 1;\n");
      const issues = await run(root);
      expect(issues.some((i) => i.title.includes("service.ts"))).toBe(false);
    } finally {
      cleanup(root);
    }
  });
});

describe("DEAD_CODE_CANDIDATE_DETECTOR — old/deprecated directories", () => {
  it("flags a file under a legacy/ directory not mentioned in docs", async () => {
    const root = makeTempDir();
    try {
      writeFile(root, "package.json", JSON.stringify({ name: "fixture", version: "1.0.0", scripts: {} }));
      writeFile(root, "src/legacy/oldThing.ts", "export {};\n");
      const issues = await run(root);
      expect(issues.some((i) => i.title.includes("oldThing.ts"))).toBe(true);
    } finally {
      cleanup(root);
    }
  });

  it("does not flag a legacy/ file that is mentioned in docs", async () => {
    const root = makeTempDir();
    try {
      writeFile(root, "package.json", JSON.stringify({ name: "fixture", version: "1.0.0", scripts: {} }));
      writeFile(root, "src/legacy/oldThing.ts", "export {};\n");
      writeFile(root, "README.md", "See src/legacy/oldThing.ts for the legacy compatibility shim.\n");
      const issues = await run(root);
      expect(issues.some((i) => i.title.includes("old/deprecated/legacy") && i.title.includes("oldThing.ts"))).toBe(false);
    } finally {
      cleanup(root);
    }
  });
});

describe("DEAD_CODE_CANDIDATE_DETECTOR — orphaned generated-looking files", () => {
  it("flags a stray .bak file", async () => {
    const root = makeTempDir();
    try {
      writeFile(root, "package.json", JSON.stringify({ name: "fixture", version: "1.0.0", scripts: {} }));
      writeFile(root, "src/notes.ts.bak", "// old\n");
      const issues = await run(root);
      expect(issues.some((i) => i.title.includes("notes.ts.bak"))).toBe(true);
    } finally {
      cleanup(root);
    }
  });

  it("does not flag a normal source file", async () => {
    const root = makeTempDir();
    try {
      writeFile(root, "package.json", JSON.stringify({ name: "fixture", version: "1.0.0", scripts: {} }));
      writeFile(root, "src/normal.ts", "export {};\n");
      const issues = await run(root);
      expect(issues.some((i) => i.category === "dead-code-candidate" && i.title.includes("Orphaned generated"))).toBe(false);
    } finally {
      cleanup(root);
    }
  });
});

describe("DEAD_CODE_CANDIDATE_DETECTOR — real self-scan regression guard", () => {
  it("produces no medium+ severity findings against this repo's own current state", async () => {
    const issues = await run(process.cwd());
    const nonInfoLow = issues.filter((i) => i.severity !== "info" && i.severity !== "low");
    expect(nonInfoLow).toEqual([]);
  });
});
