import { describe, expect, it } from "vitest";
import { getAdversarialCliTarget } from "../../src/securityValidation/cliAdversarial/adversarialCliConfig.js";
import {
  checkDeeplyNestedSource,
  checkHugeSourceFile,
  checkManyFiles,
} from "../../src/securityValidation/cliAdversarial/dataVolumeChecks.js";

// ---------------------------------------------------------------------------
// Data-volume smoke checks
//
// These tests verify that the CLI handles unusually large inputs without
// crashing or modifying source files. Sizes are bounded to stay CI-fast.
// ---------------------------------------------------------------------------

describe("CLI adversarial data volume — large source file", () => {
  it("fake CLI handles a 5,000-line source file without modifying it", async () => {
    const target = getAdversarialCliTarget();
    const result = await checkHugeSourceFile(target);

    expect(result.id).toBe("huge-source-file");
    expect(result.status).toBe("passed");
    expect(result.findings.filter((f) => f.id === "large-file-source-modified")).toHaveLength(0);
  }, 15000);

  it("result has expected category and severity", async () => {
    const target = getAdversarialCliTarget();
    const result = await checkHugeSourceFile(target);

    expect(result.category).toBe("cli-adversarial");
    expect(result.severity).toBe("major");
    expect(result.startedAt).toBeTruthy();
    expect(result.finishedAt).toBeTruthy();
  }, 15000);
});

// ---------------------------------------------------------------------------
// Many files
// ---------------------------------------------------------------------------

describe("CLI adversarial data volume — many files", () => {
  it("fake CLI handles a workspace with 100 source files without modifying any", async () => {
    const target = getAdversarialCliTarget();
    const result = await checkManyFiles(target);

    expect(result.id).toBe("many-graph-nodes-edges");
    expect(result.status).toBe("passed");
    expect(result.findings.filter((f) => f.id === "many-files-source-modified")).toHaveLength(0);
  }, 15000);

  it("result has no blocker findings", async () => {
    const target = getAdversarialCliTarget();
    const result = await checkManyFiles(target);

    expect(result.findings.filter((f) => f.severity === "blocker")).toHaveLength(0);
  }, 15000);
});

// ---------------------------------------------------------------------------
// Deeply nested directories
// ---------------------------------------------------------------------------

describe("CLI adversarial data volume — deeply nested source", () => {
  it("fake CLI handles 10 levels of nested directories without modifying source", async () => {
    const target = getAdversarialCliTarget();
    const result = await checkDeeplyNestedSource(target);

    expect(result.id).toBe("deeply-nested-tsx");
    expect(result.status).toBe("passed");
    expect(result.findings.filter((f) => f.id === "deep-nest-source-modified")).toHaveLength(0);
  });

  it("result has expected severity and metadata", async () => {
    const target = getAdversarialCliTarget();
    const result = await checkDeeplyNestedSource(target);

    expect(result.severity).toBe("minor");
    expect(result.category).toBe("cli-adversarial");
  });
});

// ---------------------------------------------------------------------------
// Result format
// ---------------------------------------------------------------------------

describe("CLI adversarial data volume — SecurityCheckResult format", () => {
  it("all data-volume check results have required fields", async () => {
    const target = getAdversarialCliTarget();
    const results = await Promise.all([
      checkHugeSourceFile(target),
      checkManyFiles(target),
      checkDeeplyNestedSource(target),
    ]);

    for (const result of results) {
      expect(typeof result.id).toBe("string");
      expect(typeof result.name).toBe("string");
      expect(result.category).toBe("cli-adversarial");
      expect(["passed", "failed", "warning", "skipped"]).toContain(result.status);
      expect(Array.isArray(result.findings)).toBe(true);
      expect(result.startedAt).toBeTruthy();
      expect(result.finishedAt).toBeTruthy();
    }
  }, 30000);

  it("no blocker findings from fake CLI data-volume checks", async () => {
    const target = getAdversarialCliTarget();
    const results = await Promise.all([
      checkHugeSourceFile(target),
      checkManyFiles(target),
      checkDeeplyNestedSource(target),
    ]);

    for (const result of results) {
      const blockers = result.findings.filter((f) => f.severity === "blocker");
      expect(blockers, `${result.id} must have no blocker findings`).toHaveLength(0);
    }
  }, 30000);
});
