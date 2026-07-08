import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { scanProjectInventory } from "../../../src/audits/core/projectInventory.js";
import { collectSourceOfTruth } from "../../../src/audits/core/sourceOfTruth.js";
import { resolveAuditTarget } from "../../../src/audits/core/auditTarget.js";
import { normalizeAuditConfig } from "../../../src/audits/core/auditConfig.js";
import { DUPLICATE_IMPLEMENTATION_DETECTOR } from "../../../src/audits/codeRot/detectors/duplicateImplementationDetector.js";
import type { AuditDetectorContext } from "../../../src/audits/core/auditRegistry.js";

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "dup-impl-test-"));
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
  return DUPLICATE_IMPLEMENTATION_DETECTOR.run(ctx);
}

describe("DUPLICATE_IMPLEMENTATION_DETECTOR — duplicate script entrypoints", () => {
  it("flags two scripts invoking the same target file", async () => {
    const root = makeTempDir();
    try {
      writeFile(
        root,
        "package.json",
        JSON.stringify({
          name: "fixture",
          version: "1.0.0",
          scripts: {
            "run-thing": "tsx scripts/thing.ts",
            "run-thing-again": "tsx scripts/thing.ts --flag",
          },
        })
      );
      writeFile(root, "scripts/thing.ts", "export {};\n");
      const issues = await run(root);
      expect(issues.some((i) => i.category === "duplicate-implementation-candidate" && i.title.includes("scripts/thing.ts"))).toBe(true);
    } finally {
      cleanup(root);
    }
  });

  it("does not flag a single script invoking a target file", async () => {
    const root = makeTempDir();
    try {
      writeFile(
        root,
        "package.json",
        JSON.stringify({ name: "fixture", version: "1.0.0", scripts: { "run-thing": "tsx scripts/thing.ts" } })
      );
      writeFile(root, "scripts/thing.ts", "export {};\n");
      const issues = await run(root);
      expect(issues.some((i) => i.title.includes("Multiple npm scripts"))).toBe(false);
    } finally {
      cleanup(root);
    }
  });
});

describe("DUPLICATE_IMPLEMENTATION_DETECTOR — parallel directories", () => {
  // Note: "report"/"reports" is intentionally NOT used as the fixture pair
  // here, even though it's in PARALLEL_DIR_PAIRS -- the shared project
  // inventory scanner (src/audits/core/projectInventory.ts) globally
  // excludes any directory literally named "reports" from traversal (it is
  // this project's own generated-output directory convention), so that
  // specific pair can never actually be observed by this detector for any
  // target. "util"/"utils" is not excluded and exercises the same logic.
  it("flags both util/ and utils/ existing as top-level directories", async () => {
    const root = makeTempDir();
    try {
      writeFile(root, "package.json", JSON.stringify({ name: "fixture", version: "1.0.0", scripts: {} }));
      writeFile(root, "util/index.ts", "export {};\n");
      writeFile(root, "utils/index.ts", "export {};\n");
      const issues = await run(root);
      expect(issues.some((i) => i.title.includes('"util/" and "utils/"'))).toBe(true);
    } finally {
      cleanup(root);
    }
  });

  it("does not flag when only one of a parallel directory pair exists", async () => {
    const root = makeTempDir();
    try {
      writeFile(root, "package.json", JSON.stringify({ name: "fixture", version: "1.0.0", scripts: {} }));
      writeFile(root, "util/index.ts", "export {};\n");
      const issues = await run(root);
      expect(issues.some((i) => i.category === "duplicate-implementation-candidate" && i.title.includes("parallel"))).toBe(false);
    } finally {
      cleanup(root);
    }
  });
});

describe("DUPLICATE_IMPLEMENTATION_DETECTOR — basename repeats across roots", () => {
  it("flags a non-generic basename repeated across two unrelated src roots (weak signal)", async () => {
    const root = makeTempDir();
    try {
      writeFile(root, "package.json", JSON.stringify({ name: "fixture", version: "1.0.0", scripts: {} }));
      writeFile(root, "src/featureA/uniqueWidget.ts", "export {};\n");
      writeFile(root, "src/featureB/uniqueWidget.ts", "export {};\n");
      const issues = await run(root);
      const issue = issues.find((i) => i.title.includes("uniquewidget"));
      expect(issue).toBeDefined();
      expect(issue?.severity).toBe("info");
    } finally {
      cleanup(root);
    }
  });

  it("does not flag generic infra basenames (e.g. index, types) repeated across roots", async () => {
    const root = makeTempDir();
    try {
      writeFile(root, "package.json", JSON.stringify({ name: "fixture", version: "1.0.0", scripts: {} }));
      writeFile(root, "src/featureA/types.ts", "export {};\n");
      writeFile(root, "src/featureB/types.ts", "export {};\n");
      const issues = await run(root);
      expect(issues.some((i) => i.title.includes('"types"'))).toBe(false);
    } finally {
      cleanup(root);
    }
  });
});

describe("DUPLICATE_IMPLEMENTATION_DETECTOR — real self-scan regression guard", () => {
  it("produces no findings above info severity against this repo's own current state", async () => {
    const issues = await run(process.cwd());
    expect(issues.every((i) => i.severity === "info" || i.severity === "low")).toBe(true);
  });
});
