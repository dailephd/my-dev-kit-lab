import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { scanProjectInventory } from "../../../src/audits/core/projectInventory.js";
import { collectSourceOfTruth } from "../../../src/audits/core/sourceOfTruth.js";
import { collectSourceFacts } from "../../../src/audits/core/collectSourceFacts.js";
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

async function runWithSourceFacts(root: string) {
  const ctx = buildContext(root);
  const sourceFacts = await collectSourceFacts(root, ctx.inventory);
  return DUPLICATE_IMPLEMENTATION_DETECTOR.run({ ...ctx, sourceFacts });
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

describe("DUPLICATE_IMPLEMENTATION_DETECTOR — source-facts-derived duplicate declarations", () => {
  it("flags the same exported class name parsed in two unrelated source files", async () => {
    const root = makeTempDir();
    try {
      writeFile(root, "package.json", JSON.stringify({ name: "fixture", version: "1.0.0", scripts: {} }));
      writeFile(root, "src/featureA/logger.ts", "export class Logger { log() {} }\n");
      writeFile(root, "src/featureB/logger.ts", "export class Logger { log() {} }\n");
      const issues = await runWithSourceFacts(root);
      expect(
        issues.some(
          (i) => i.category === "duplicate-implementation-candidate" && i.title.includes('"Logger"') && i.title.includes("class")
        )
      ).toBe(true);
    } finally {
      cleanup(root);
    }
  });

  it("does not flag a generic exported declaration name (e.g. 'run') across files", async () => {
    const root = makeTempDir();
    try {
      writeFile(root, "package.json", JSON.stringify({ name: "fixture", version: "1.0.0", scripts: {} }));
      writeFile(root, "src/featureA/entry.ts", "export function run() {}\n");
      writeFile(root, "src/featureB/entry.ts", "export function run() {}\n");
      const issues = await runWithSourceFacts(root);
      expect(issues.some((i) => i.title.includes('"run"'))).toBe(false);
    } finally {
      cleanup(root);
    }
  });

  it("does not flag a non-exported declaration with the same name", async () => {
    const root = makeTempDir();
    try {
      writeFile(root, "package.json", JSON.stringify({ name: "fixture", version: "1.0.0", scripts: {} }));
      writeFile(root, "src/featureA/logger.ts", "class Logger { log() {} }\nexport {};\n");
      writeFile(root, "src/featureB/logger.ts", "class Logger { log() {} }\nexport {};\n");
      const issues = await runWithSourceFacts(root);
      expect(issues.some((i) => i.title.includes('"Logger"'))).toBe(false);
    } finally {
      cleanup(root);
    }
  });

  it("does not flag when sourceFacts is absent from the detector context", async () => {
    const root = makeTempDir();
    try {
      writeFile(root, "package.json", JSON.stringify({ name: "fixture", version: "1.0.0", scripts: {} }));
      writeFile(root, "src/featureA/logger.ts", "export class Logger { log() {} }\n");
      writeFile(root, "src/featureB/logger.ts", "export class Logger { log() {} }\n");
      const issues = await run(root); // buildContext() with no sourceFacts field
      expect(issues.some((i) => i.title.includes('"Logger"'))).toBe(false);
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

  // v0.3.1 Batch 6 -- the test above never actually exercises
  // findDuplicateDeclarationCandidates() against this repo's real code:
  // run() builds a context via buildContext(), which has no `sourceFacts`
  // field, so the source-facts-derived check returns [] before ever
  // touching this repo's own duplicate declaration names (e.g. "Logger",
  // "TaskService", "TaskStore" across this repo's benchmark fixtures --
  // manually confirmed via `npm run audit` smoke output in Batch 5). This
  // is the actual regression guard for that check: real sourceFacts,
  // against this repo's real ~500-file source tree, asserting the
  // source-facts-derived findings stay conservative (info/low) the same
  // way the regex-based checks above already are.
  it("keeps source-facts-derived duplicate-declaration candidates at info/low against this repo's own real source facts", async () => {
    const issues = await runWithSourceFacts(process.cwd());
    const sourceFactsDerived = issues.filter((i) =>
      i.evidence.some((e) => e.message.startsWith("Source facts:"))
    );
    // This repo's benchmark fixtures are expected to produce at least one
    // real source-facts-derived candidate (see Batch 5's manual smoke
    // inspection) -- if this ever drops to zero, the check likely broke
    // silently rather than the repo becoming duplicate-free, so this is
    // worth knowing about rather than silently passing on an empty array.
    expect(sourceFactsDerived.length).toBeGreaterThan(0);
    expect(sourceFactsDerived.every((i) => i.severity === "info")).toBe(true);
    expect(sourceFactsDerived.every((i) => i.confidence === "low")).toBe(true);
    expect(sourceFactsDerived.every((i) => i.falsePositiveRisk === "high")).toBe(true);
  });
});
