import { describe, expect, it } from "vitest";
import { getAdversarialCliTarget } from "../../src/securityValidation/cliAdversarial/adversarialCliConfig.js";
import {
  checkFailureProducesJsonError,
  checkJsonOutputIsParseable,
  checkProgressNotInJsonStdout,
  checkStderrNotInStdout,
} from "../../src/securityValidation/cliAdversarial/jsonStdoutChecks.js";

// ---------------------------------------------------------------------------
// JSON stdout parseable check
// ---------------------------------------------------------------------------

describe("CLI adversarial JSON stdout — output is parseable", () => {
  it("fake CLI produces parseable JSON when --format json is passed", async () => {
    const target = getAdversarialCliTarget();
    const result = await checkJsonOutputIsParseable(target);

    expect(result.id).toBe("json-mode-parseable-output");
    expect(result.status).toBe("passed");
    expect(result.findings.filter((f) => f.id === "json-stdout-not-parseable")).toHaveLength(0);
  });

  it("result has expected metadata", async () => {
    const target = getAdversarialCliTarget();
    const result = await checkJsonOutputIsParseable(target);

    expect(result.category).toBe("cli-adversarial");
    expect(result.severity).toBe("major");
    expect(result.startedAt).toBeTruthy();
    expect(result.finishedAt).toBeTruthy();
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });
});

// ---------------------------------------------------------------------------
// Stderr not in stdout check
// ---------------------------------------------------------------------------

describe("CLI adversarial JSON stdout — warnings go to stderr only", () => {
  it("fake CLI does not mix warning messages into JSON stdout", async () => {
    const target = getAdversarialCliTarget();
    const result = await checkStderrNotInStdout(target);

    expect(result.id).toBe("warnings-go-to-stderr");
    expect(result.status).toBe("passed");
    expect(result.findings.filter((f) => f.id === "warning-in-stdout")).toHaveLength(0);
  });

  it("stdout remains valid JSON even when a warning is emitted to stderr", async () => {
    const target = getAdversarialCliTarget();
    const result = await checkStderrNotInStdout(target);

    expect(result.findings.filter((f) => f.id === "stdout-not-json-with-stderr")).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Failure produces JSON error check
// ---------------------------------------------------------------------------

describe("CLI adversarial JSON stdout — failure produces JSON error object", () => {
  it("fake CLI emits a valid JSON error object when --fail is passed", async () => {
    const target = getAdversarialCliTarget();
    const result = await checkFailureProducesJsonError(target);

    expect(result.id).toBe("json-error-object-on-failure");
    expect(result.status).toBe("passed");
    expect(result.findings.filter((f) => f.id === "json-error-not-parseable")).toHaveLength(0);
  });

  it("fake CLI exits non-zero when --fail is passed", async () => {
    const target = getAdversarialCliTarget();
    const result = await checkFailureProducesJsonError(target);

    // If exit code were 0 we'd have a finding for "failure-exit-code-zero"
    expect(result.findings.filter((f) => f.id === "failure-exit-code-zero")).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Progress not in JSON stdout check
// ---------------------------------------------------------------------------

describe("CLI adversarial JSON stdout — progress does not corrupt JSON stdout", () => {
  it("fake CLI keeps progress output off JSON stdout", async () => {
    const target = getAdversarialCliTarget();
    const result = await checkProgressNotInJsonStdout(target);

    expect(result.id).toBe("progress-not-in-json-stdout");
    // Fake target: should pass; real target: may be skipped
    if (result.status !== "skipped") {
      expect(result.status).toBe("passed");
      expect(result.findings.filter((f) => f.id === "progress-in-json-stdout")).toHaveLength(0);
      expect(result.findings.filter((f) => f.id === "progress-corrupted-json")).toHaveLength(0);
    } else {
      expect(result.skippedReason).toBeTruthy();
    }
  });
});

// ---------------------------------------------------------------------------
// Result format
// ---------------------------------------------------------------------------

describe("CLI adversarial JSON stdout — SecurityCheckResult format", () => {
  it("all JSON stdout check results have required fields", async () => {
    const target = getAdversarialCliTarget();
    const results = await Promise.all([
      checkJsonOutputIsParseable(target),
      checkStderrNotInStdout(target),
      checkFailureProducesJsonError(target),
      checkProgressNotInJsonStdout(target),
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
  });

  it("no blocker findings from fake CLI JSON stdout checks", async () => {
    const target = getAdversarialCliTarget();
    const results = await Promise.all([
      checkJsonOutputIsParseable(target),
      checkStderrNotInStdout(target),
      checkFailureProducesJsonError(target),
      checkProgressNotInJsonStdout(target),
    ]);

    for (const result of results) {
      const blockers = result.findings.filter((f) => f.severity === "blocker");
      expect(blockers, `${result.id} should have no blocker findings`).toHaveLength(0);
    }
  });
});
