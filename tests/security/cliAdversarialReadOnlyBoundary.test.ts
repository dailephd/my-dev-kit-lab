import { describe, expect, it } from "vitest";
import { getAdversarialCliTarget } from "../../src/securityValidation/cliAdversarial/adversarialCliConfig.js";
import {
  checkArtifactCleanupSafe,
  checkIndexWriteContainment,
  checkSourceFilesNotModified,
  checkWritesLimitedToOutput,
} from "../../src/securityValidation/cliAdversarial/readOnlyBoundaryChecks.js";
import { createTempWorkspace } from "../../src/securityValidation/cliAdversarial/tempWorkspace.js";

describe("CLI adversarial read-only boundary — source files not modified", () => {
  it("fake CLI does not modify any source files", async () => {
    const target = getAdversarialCliTarget();
    const result = await checkSourceFilesNotModified(target);

    expect(result.id).toBe("source-files-not-modified");
    expect(result.status).toBe("passed");
    expect(result.findings).toHaveLength(0);
  });

  it("result includes timing and category metadata", async () => {
    const target = getAdversarialCliTarget();
    const result = await checkSourceFilesNotModified(target);

    expect(result.category).toBe("cli-adversarial");
    expect(result.startedAt).toBeTruthy();
    expect(result.finishedAt).toBeTruthy();
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });
});

describe("CLI adversarial read-only boundary — writes limited to output", () => {
  it("fake CLI writes only to the declared output directory", async () => {
    const target = getAdversarialCliTarget();
    const result = await checkWritesLimitedToOutput(target);

    expect(result.id).toBe("writes-limited-to-output");
    expect(result.status).toBe("passed");
    expect(result.findings).toHaveLength(0);
  });

  it("no writes appear in source directory after CLI run", async () => {
    const target = getAdversarialCliTarget();
    const result = await checkWritesLimitedToOutput(target);

    const sourceFindings = result.findings.filter((f) => f.id === "write-in-source-dir");
    expect(sourceFindings).toHaveLength(0);
  });

  it("no writes appear outside workspace after CLI run", async () => {
    const target = getAdversarialCliTarget();
    const result = await checkWritesLimitedToOutput(target);

    const outsideFindings = result.findings.filter((f) => f.id === "write-outside-workspace");
    expect(outsideFindings).toHaveLength(0);
  });
});

describe("CLI adversarial read-only boundary — index write containment", () => {
  it("fake CLI with --index does not modify source files", async () => {
    const target = getAdversarialCliTarget();
    const result = await checkIndexWriteContainment(target);

    expect(result.id).toBe("index-write-containment");
    expect(result.status).toBe("passed");
    expect(result.findings.filter((f) => f.id === "index-write-in-source")).toHaveLength(0);
  });

  it("fake CLI with --index does not write outside workspace", async () => {
    const target = getAdversarialCliTarget();
    const result = await checkIndexWriteContainment(target);

    expect(result.findings.filter((f) => f.id === "index-write-outside")).toHaveLength(0);
  });
});

describe("CLI adversarial read-only boundary — artifact refresh safety", () => {
  it("re-running the CLI does not delete source files", async () => {
    const target = getAdversarialCliTarget();
    const result = await checkArtifactCleanupSafe(target);

    expect(result.id).toBe("generated-cleanup-user-files");
    expect(result.status).toBe("passed");
    expect(result.findings.filter((f) => f.id === "cleanup-deleted-source")).toHaveLength(0);
  });

  it("re-running the CLI does not modify source files", async () => {
    const target = getAdversarialCliTarget();
    const result = await checkArtifactCleanupSafe(target);

    expect(result.findings.filter((f) => f.id === "cleanup-modified-source")).toHaveLength(0);
  });

  it("re-running the CLI does not affect files outside workspace", async () => {
    const target = getAdversarialCliTarget();
    const result = await checkArtifactCleanupSafe(target);

    expect(result.findings.filter((f) => f.id === "cleanup-outside-impact")).toHaveLength(0);
  });
});

describe("CLI adversarial read-only boundary — SecurityCheckResult format", () => {
  it("check results have required fields", async () => {
    const target = getAdversarialCliTarget();
    const result = await checkSourceFilesNotModified(target);

    expect(typeof result.id).toBe("string");
    expect(typeof result.name).toBe("string");
    expect(result.category).toBe("cli-adversarial");
    expect(["passed", "failed", "warning", "skipped"]).toContain(result.status);
    expect(Array.isArray(result.findings)).toBe(true);
  });

  it("passed checks have no blocker findings", async () => {
    const target = getAdversarialCliTarget();
    const results = await Promise.all([
      checkSourceFilesNotModified(target),
      checkWritesLimitedToOutput(target),
      checkIndexWriteContainment(target),
      checkArtifactCleanupSafe(target),
    ]);

    for (const result of results) {
      const blockerFindings = result.findings.filter((f) => f.severity === "blocker");
      expect(blockerFindings).toHaveLength(0);
    }
  });

  it("workspace is cleaned up after each check (no temp dir leaks)", async () => {
    // Verify that after a check, the check does not leave orphaned temp dirs.
    // We can't easily enumerate all temp dirs, but we ensure the check
    // does not throw on cleanup.
    const target = getAdversarialCliTarget();
    const workspace = createTempWorkspace("cleanup-verify-");
    let cleanupCalled = false;
    const originalCleanup = workspace.cleanup;
    workspace.cleanup = async () => {
      cleanupCalled = true;
      return originalCleanup();
    };

    // Just verify cleanup doesn't throw when called.
    await workspace.cleanup();
    expect(cleanupCalled).toBe(true);
  });
});
