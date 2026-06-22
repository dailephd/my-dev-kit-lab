import { describe, expect, it } from "vitest";
import { getAdversarialCliTarget } from "../../src/securityValidation/cliAdversarial/adversarialCliConfig.js";
import {
  checkAllMalformedManifestCases,
  checkMalformedCodeGraph,
  checkMalformedManifest,
  checkMissingIndexDirectory,
  checkUnsupportedSchemaVersion,
} from "../../src/securityValidation/cliAdversarial/malformedArtifactChecks.js";
import {
  MALFORMED_CODE_GRAPH_CASES,
  MALFORMED_MANIFEST_CASES,
  UNSUPPORTED_SCHEMA_VERSION_CASES,
  placeMalformedManifest,
} from "../../src/securityValidation/cliAdversarial/malformedArtifactFixtures.js";
import { createTempWorkspace } from "../../src/securityValidation/cliAdversarial/tempWorkspace.js";

// ---------------------------------------------------------------------------
// Fixture catalog tests
// ---------------------------------------------------------------------------

describe("malformed artifact fixtures — catalog", () => {
  it("malformed manifest cases have required fields", () => {
    for (const c of MALFORMED_MANIFEST_CASES) {
      expect(c.id, "id must not be empty").toBeTruthy();
      expect(c.description, "description must not be empty").toBeTruthy();
      expect(typeof c.content).toBe("string");
    }
  });

  it("malformed code-graph cases have required fields", () => {
    for (const c of MALFORMED_CODE_GRAPH_CASES) {
      expect(c.id).toBeTruthy();
      expect(c.description).toBeTruthy();
      expect(typeof c.content).toBe("string");
    }
  });

  it("unsupported schema version cases have required fields", () => {
    for (const c of UNSUPPORTED_SCHEMA_VERSION_CASES) {
      expect(c.id).toBeTruthy();
      expect(c.description).toBeTruthy();
      expect(typeof c.content).toBe("string");
    }
  });

  it("malformed manifest cases include at least one truncated-json case", () => {
    const truncated = MALFORMED_MANIFEST_CASES.find((c) => c.id === "truncated-json");
    expect(truncated).toBeTruthy();
    // Content must actually be invalid JSON
    expect(() => JSON.parse(truncated!.content)).toThrow();
  });

  it("malformed manifest cases include at least one null-value case", () => {
    const nullCase = MALFORMED_MANIFEST_CASES.find((c) => c.id === "null-value");
    expect(nullCase).toBeTruthy();
    expect(JSON.parse(nullCase!.content)).toBeNull();
  });

  it("unsupported schema version cases include a future-version case", () => {
    const future = UNSUPPORTED_SCHEMA_VERSION_CASES.find((c) => c.id === "future-version");
    expect(future).toBeTruthy();
    const parsed = JSON.parse(future!.content) as { schemaVersion: number };
    expect(parsed.schemaVersion).toBeGreaterThan(100);
  });

  it("placeMalformedManifest writes the content to the given directory", () => {
    const workspace = createTempWorkspace("mf-fixture-test-");
    try {
      const testContent = '{"broken": true, missing-close';
      placeMalformedManifest(workspace.indexDir, testContent);

      const { readFileSync, existsSync } = require("node:fs");
      const manifestPath = `${workspace.indexDir}/manifest.json`;
      expect(existsSync(manifestPath)).toBe(true);
      expect(readFileSync(manifestPath, "utf8")).toBe(testContent);
    } finally {
      // Sync cleanup for fixture test
      const { rmSync } = require("node:fs");
      try {
        rmSync(workspace.root, { recursive: true, force: true });
        rmSync(workspace.outsideDir, { recursive: true, force: true });
      } catch {
        // ignore cleanup errors in fixture tests
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Malformed manifest check
// ---------------------------------------------------------------------------

describe("CLI adversarial malformed artifacts — malformed manifest", () => {
  it("fake CLI handles a pre-placed truncated manifest.json safely", async () => {
    const target = getAdversarialCliTarget();
    const result = await checkMalformedManifest(target);

    expect(result.id).toBe("malformed-manifest-json");
    expect(result.category).toBe("artifact-safety");
    expect(result.status).toBe("passed");
    expect(result.findings.filter((f) => f.severity === "blocker")).toHaveLength(0);
  });

  it("result includes timing and severity metadata", async () => {
    const target = getAdversarialCliTarget();
    const result = await checkMalformedManifest(target);

    expect(result.startedAt).toBeTruthy();
    expect(result.finishedAt).toBeTruthy();
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    expect(result.severity).toBe("major");
  });

  it("fake CLI passes all malformed manifest cases", async () => {
    const target = getAdversarialCliTarget();
    const result = await checkAllMalformedManifestCases(target);

    expect(result.id).toBe("malformed-manifest-all-cases");
    expect(result.status).toBe("passed");
    expect(result.findings.filter((f) => f.severity === "blocker")).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Malformed code-graph check
// ---------------------------------------------------------------------------

describe("CLI adversarial malformed artifacts — malformed code graph", () => {
  it("fake CLI handles a pre-placed malformed code-graph.json safely", async () => {
    const target = getAdversarialCliTarget();
    const result = await checkMalformedCodeGraph(target);

    expect(result.id).toBe("malformed-code-graph-json");
    expect(result.status).toBe("passed");
    expect(result.findings.filter((f) => f.severity === "blocker")).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Unsupported schema version check
// ---------------------------------------------------------------------------

describe("CLI adversarial malformed artifacts — unsupported schema version", () => {
  it("fake CLI handles an artifact with a future schemaVersion safely", async () => {
    const target = getAdversarialCliTarget();
    const result = await checkUnsupportedSchemaVersion(target);

    expect(result.id).toBe("unsupported-schema-version");
    expect(result.status).toBe("passed");
    expect(result.findings.filter((f) => f.severity === "blocker")).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Missing index directory check
// ---------------------------------------------------------------------------

describe("CLI adversarial malformed artifacts — missing index directory", () => {
  it("fake CLI handles a missing index directory gracefully", async () => {
    const target = getAdversarialCliTarget();
    const result = await checkMissingIndexDirectory(target);

    expect(result.id).toBe("missing-index-directory");
    // Fake CLI creates the dir if missing (mkdirSync recursive) → passes
    expect(result.status).toBe("passed");
    expect(result.findings.filter((f) => f.severity === "blocker")).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Result format
// ---------------------------------------------------------------------------

describe("CLI adversarial malformed artifacts — SecurityCheckResult format", () => {
  it("all malformed artifact check results have required fields", async () => {
    const target = getAdversarialCliTarget();
    const results = await Promise.all([
      checkMalformedManifest(target),
      checkMalformedCodeGraph(target),
      checkUnsupportedSchemaVersion(target),
      checkMissingIndexDirectory(target),
    ]);

    for (const result of results) {
      expect(typeof result.id).toBe("string");
      expect(typeof result.name).toBe("string");
      expect(["artifact-safety", "cli-adversarial"]).toContain(result.category);
      expect(["passed", "failed", "warning", "skipped"]).toContain(result.status);
      expect(Array.isArray(result.findings)).toBe(true);
      expect(result.startedAt).toBeTruthy();
      expect(result.finishedAt).toBeTruthy();
    }
  });
});
