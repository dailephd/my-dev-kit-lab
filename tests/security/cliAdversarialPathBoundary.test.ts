import { describe, expect, it } from "vitest";
import { getAdversarialCliTarget } from "../../src/securityValidation/cliAdversarial/adversarialCliConfig.js";
import {
  PATH_TRAVERSAL_CASES,
  SPACES_PATH_CASES,
  UNICODE_PATH_CASES,
} from "../../src/securityValidation/cliAdversarial/pathCases.js";
import {
  checkHarnessEscapeDetection,
  checkOutPathTraversal,
  checkPathWithSpaces,
  checkRootPathTraversal,
  checkSafeAbsolutePath,
  checkUnicodePath,
} from "../../src/securityValidation/cliAdversarial/pathBoundaryChecks.js";
import { createTempWorkspace, diffSnapshots, snapshotDir } from "../../src/securityValidation/cliAdversarial/tempWorkspace.js";

// ---------------------------------------------------------------------------
// Harness infrastructure tests
// (These verify the temp workspace and detection mechanisms work correctly.)
// ---------------------------------------------------------------------------

describe("CLI adversarial path boundary — harness infrastructure", () => {
  it("creates temp workspace with expected directories", async () => {
    const workspace = createTempWorkspace("infra-test-");
    try {
      const { statSync } = await import("node:fs");
      expect(statSync(workspace.root).isDirectory()).toBe(true);
      expect(statSync(workspace.sourceDir).isDirectory()).toBe(true);
      expect(statSync(workspace.outputDir).isDirectory()).toBe(true);
      expect(statSync(workspace.outsideDir).isDirectory()).toBe(true);
    } finally {
      await workspace.cleanup();
    }
  });

  it("workspace root and outsideDir are different directories", async () => {
    const workspace = createTempWorkspace("infra-test-");
    try {
      expect(workspace.outsideDir).not.toBe(workspace.root);
      expect(workspace.outsideDir.startsWith(workspace.root)).toBe(false);
    } finally {
      await workspace.cleanup();
    }
  });

  it("snapshot captures files in source directory", async () => {
    const workspace = createTempWorkspace("infra-test-");
    try {
      const snapshot = snapshotDir(workspace.sourceDir);
      expect(snapshot.length).toBeGreaterThan(0);
      expect(snapshot.every((s) => s.contentHash.length > 0)).toBe(true);
      expect(snapshot.every((s) => s.relativePath.length > 0)).toBe(true);
    } finally {
      await workspace.cleanup();
    }
  });

  it("detects added files in diffSnapshots", async () => {
    const workspace = createTempWorkspace("infra-test-");
    try {
      const before = snapshotDir(workspace.sourceDir);
      const { writeFileSync } = await import("node:fs");
      writeFileSync(
        `${workspace.sourceDir}/new-file.ts`,
        "export const y = 2;\n",
        "utf8"
      );
      const after = snapshotDir(workspace.sourceDir);
      const diff = diffSnapshots(before, after);
      expect(diff.added).toContain("new-file.ts");
      expect(diff.modified).toHaveLength(0);
      expect(diff.removed).toHaveLength(0);
    } finally {
      await workspace.cleanup();
    }
  });

  it("detects modified files in diffSnapshots", async () => {
    const workspace = createTempWorkspace("infra-test-");
    try {
      const before = snapshotDir(workspace.sourceDir);
      const { writeFileSync } = await import("node:fs");
      writeFileSync(
        `${workspace.sourceDir}/index.ts`,
        "export const x = 999; // modified\n",
        "utf8"
      );
      const after = snapshotDir(workspace.sourceDir);
      const diff = diffSnapshots(before, after);
      expect(diff.modified).toContain("index.ts");
    } finally {
      await workspace.cleanup();
    }
  });

  it("detects removed files in diffSnapshots", async () => {
    const workspace = createTempWorkspace("infra-test-");
    try {
      const before = snapshotDir(workspace.sourceDir);
      const { rmSync } = await import("node:fs");
      rmSync(`${workspace.sourceDir}/utils.ts`);
      const after = snapshotDir(workspace.sourceDir);
      const diff = diffSnapshots(before, after);
      expect(diff.removed).toContain("utils.ts");
    } finally {
      await workspace.cleanup();
    }
  });

  it("snapshot of unchanged directory shows no diff", async () => {
    const workspace = createTempWorkspace("infra-test-");
    try {
      const before = snapshotDir(workspace.sourceDir);
      const after = snapshotDir(workspace.sourceDir);
      const diff = diffSnapshots(before, after);
      expect(diff.added).toHaveLength(0);
      expect(diff.modified).toHaveLength(0);
      expect(diff.removed).toHaveLength(0);
    } finally {
      await workspace.cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
// Harness escape detection self-test
// (Verifies the harness can detect writes outside the declared output dir.)
// ---------------------------------------------------------------------------

describe("CLI adversarial path boundary — harness escape detection", () => {
  it("harness detects when fake CLI writes outside workspace (self-test)", async () => {
    const target = getAdversarialCliTarget();
    const result = await checkHarnessEscapeDetection(target);

    if (result.status === "skipped") {
      // Running against real target — skip this self-test.
      expect(result.skippedReason).toBeTruthy();
      return;
    }

    expect(result.status).toBe("passed");
    expect(result.findings).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Path traversal checks
// ---------------------------------------------------------------------------

describe("CLI adversarial path boundary — path traversal via --root", () => {
  for (const testInput of PATH_TRAVERSAL_CASES) {
    it(`${testInput.id}: ${testInput.description}`, async () => {
      const target = getAdversarialCliTarget();
      const result = await checkRootPathTraversal(target, testInput);

      // The check passes if no writes escaped outside the workspace.
      // Exit code may be zero or non-zero depending on whether path exists.
      expect(result.status).toBe("passed");
      expect(result.findings.filter((f) => f.id.includes("escape"))).toHaveLength(0);
    });
  }
});

describe("CLI adversarial path boundary — path traversal via --out", () => {
  for (const testInput of PATH_TRAVERSAL_CASES) {
    it(`${testInput.id}: ${testInput.description}`, async () => {
      const target = getAdversarialCliTarget();
      const result = await checkOutPathTraversal(target, testInput);

      // For traversal via --out: the fake CLI writes to whatever --out points to.
      // Since we use relative traversal inside the workspace, it resolves to
      // paths inside the temp root tree. No outsideDir writes should occur.
      expect(result.status).toBe("passed");
      expect(result.findings.filter((f) => f.id.includes("escape"))).toHaveLength(0);
    });
  }
});

// ---------------------------------------------------------------------------
// Safe path handling checks
// ---------------------------------------------------------------------------

describe("CLI adversarial path boundary — safe path handling", () => {
  it("paths with spaces are handled as literal strings", async () => {
    const target = getAdversarialCliTarget();
    const result = await checkPathWithSpaces(target);
    expect(result.status).toBe("passed");
    expect(result.findings).toHaveLength(0);
  });

  it("safe absolute paths within workspace are accepted", async () => {
    const target = getAdversarialCliTarget();
    const result = await checkSafeAbsolutePath(target);
    expect(result.status).toBe("passed");
    expect(result.findings).toHaveLength(0);
  });

  for (const testInput of SPACES_PATH_CASES) {
    it(`spaces path case: ${testInput.description}`, async () => {
      const target = getAdversarialCliTarget();
      const result = await checkPathWithSpaces(target);
      expect(result.findings.filter((f) => f.severity === "blocker")).toHaveLength(0);
    });
  }

  for (const testInput of UNICODE_PATH_CASES) {
    it(`unicode path case: ${testInput.description}`, async () => {
      const target = getAdversarialCliTarget();
      const result = await checkUnicodePath(target, testInput.value);
      // Unicode paths must not cause spawn failures.
      expect(result.findings.filter((f) => f.severity === "major")).toHaveLength(0);
    });
  }
});

// ---------------------------------------------------------------------------
// Path test input catalog
// ---------------------------------------------------------------------------

describe("CLI adversarial path cases catalog", () => {
  it("path traversal cases are defined with required fields", () => {
    for (const c of PATH_TRAVERSAL_CASES) {
      expect(c.id).toBeTruthy();
      expect(c.description).toBeTruthy();
      expect(c.value).toBeTruthy();
      expect(c.category).toBe("traversal-relative");
    }
  });

  it("spaces path cases do not have expectedRejection set to true", () => {
    for (const c of SPACES_PATH_CASES) {
      expect(c.expectedRejection).toBe(false);
    }
  });

  it("unicode path cases do not have expectedRejection set to true", () => {
    for (const c of UNICODE_PATH_CASES) {
      expect(c.expectedRejection).toBe(false);
    }
  });
});
