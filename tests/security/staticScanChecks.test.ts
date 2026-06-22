import { describe, expect, it } from "vitest";
import { runCodeqlCheck } from "../../src/securityValidation/staticScans/codeql.js";
import { runSemgrepCheck, parseSemgrepJson } from "../../src/securityValidation/staticScans/semgrep.js";

// ---------------------------------------------------------------------------
// Static scan checks
//
// Both CodeQL and Semgrep are optional tools. These tests verify that:
//   - Unavailable tools produce a structured "skipped" result, not a crash.
//   - The result always conforms to SecurityCheckResult shape.
//   - JSON parsers handle minimal and empty outputs without throwing.
// ---------------------------------------------------------------------------

describe("CodeQL check — unavailable CLI", () => {
  it("returns a skipped result when CodeQL CLI is not in PATH", async () => {
    // CodeQL is not expected to be in PATH on standard dev/CI machines.
    // This test passes on any machine; if CodeQL IS present, we accept passed too.
    const result = await runCodeqlCheck({ cwd: process.cwd(), timeoutMs: 5000 });
    expect(["skipped", "passed", "failed", "warning"]).toContain(result.status);
    expect(result.id).toBe("codeql-scan");
    expect(result.category).toBe("static-scan");
    expect(Array.isArray(result.findings)).toBe(true);
    expect(result.startedAt).toBeTruthy();
    expect(result.finishedAt).toBeTruthy();
  });

  it("skipped result has a human-readable skippedReason", async () => {
    const result = await runCodeqlCheck({ cwd: process.cwd(), timeoutMs: 5000 });
    if (result.status === "skipped") {
      expect(result.skippedReason).toBeTruthy();
      expect(typeof result.skippedReason).toBe("string");
    }
    // If not skipped, that is also acceptable.
  });

  it("result severity is never undefined", async () => {
    const result = await runCodeqlCheck({ cwd: process.cwd(), timeoutMs: 5000 });
    expect(result.severity).toBeTruthy();
  });

  it("absence of CodeQL does not produce blocker findings", async () => {
    const result = await runCodeqlCheck({ cwd: process.cwd(), timeoutMs: 5000 });
    if (result.status === "skipped") {
      expect(result.findings).toHaveLength(0);
    }
  });
});

describe("Semgrep check — unavailable CLI", () => {
  it("returns a structured result (skipped or passed/warned/failed) regardless of tool availability", async () => {
    const result = await runSemgrepCheck({ targetRoot: process.cwd(), timeoutMs: 30_000 });
    expect(result.id).toBe("semgrep-scan");
    expect(result.category).toBe("static-scan");
    expect(["skipped", "passed", "failed", "warning"]).toContain(result.status);
    expect(Array.isArray(result.findings)).toBe(true);
    expect(result.startedAt).toBeTruthy();
    expect(result.finishedAt).toBeTruthy();
  }, 35000);

  it("skipped result has a skippedReason when tool is unavailable", async () => {
    const result = await runSemgrepCheck({ targetRoot: process.cwd(), timeoutMs: 30_000 });
    if (result.status === "skipped") {
      expect(typeof result.skippedReason).toBe("string");
      expect(result.skippedReason!.length).toBeGreaterThan(0);
    }
  }, 35000);
});

describe("parseSemgrepJson — unit tests", () => {
  it("parses empty string as zero findings", () => {
    const result = parseSemgrepJson("");
    expect(result.findings).toHaveLength(0);
    expect(result.parseError).toBeUndefined();
  });

  it("parses empty results array", () => {
    const result = parseSemgrepJson(JSON.stringify({ results: [], errors: [] }));
    expect(result.findings).toHaveLength(0);
    expect(result.parseError).toBeUndefined();
  });

  it("parses a minimal semgrep result with one finding", () => {
    const raw = JSON.stringify({
      results: [
        {
          check_id: "no-shell-true-in-spawn",
          path: "src/index.ts",
          start: { line: 10 },
          extra: {
            severity: "ERROR",
            message: "spawn with shell:true is unsafe",
          },
        },
      ],
      errors: [],
    });
    const result = parseSemgrepJson(raw);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].ruleId).toBe("no-shell-true-in-spawn");
    expect(result.findings[0].severity).toBe("ERROR");
    expect(result.findings[0].path).toBe("src/index.ts");
    expect(result.findings[0].line).toBe(10);
  });

  it("returns parseError for invalid JSON", () => {
    const result = parseSemgrepJson("{not-valid-json}}}");
    expect(result.parseError).toBeTruthy();
    expect(result.findings).toHaveLength(0);
  });

  it("handles missing results field gracefully", () => {
    const result = parseSemgrepJson(JSON.stringify({ errors: [] }));
    expect(result.findings).toHaveLength(0);
    expect(result.parseError).toBeUndefined();
  });

  it("handles null results field", () => {
    const result = parseSemgrepJson(JSON.stringify({ results: null }));
    expect(result.findings).toHaveLength(0);
  });
});
