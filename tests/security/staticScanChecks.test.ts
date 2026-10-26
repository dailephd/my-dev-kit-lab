import { afterEach, describe, expect, it, vi } from "vitest";
import { runCodeqlCheck } from "../../src/securityValidation/staticScans/codeql.js";
import { runSemgrepCheck, parseSemgrepJson } from "../../src/securityValidation/staticScans/semgrep.js";
import * as commands from "../../src/securityValidation/commandRunner.js";
import * as resolver from "../../src/core/resolveCommand.js";
import * as codeql from "../../src/securityValidation/staticScans/codeql.js";
import { runSecurityValidation } from "../../src/securityValidation/validate/runSecurityValidation.js";
import { buildSecurityReportFromSummary } from "../../src/securityValidation/report/buildSecurityReport.js";
import { renderJsonReport } from "../../src/securityValidation/report/renderSecurityReport.js";
import type { CommandExecutionResult } from "../../src/securityValidation/types.js";
import { DEFAULT_SECURITY_CONFIG, resolveSemgrepCommandTimeoutMs } from "../../src/securityValidation/config.js";

afterEach(() => vi.restoreAllMocks());
const cleanOutput = { results: [], errors: [], paths: { scanned: ["src/index.ts"] } };
function finding(severity = "ERROR") {
  return { check_id: `rule-${severity}`, path: "src/index.ts", start: { line: 10 },
    extra: { severity, message: "Security finding" } };
}
function mockExecution(overrides: Partial<CommandExecutionResult> = {}, availability: "native" | "fallback" | "absent" = "native") {
  vi.spyOn(resolver, "resolveCommand").mockImplementation((command) => ({ originalCommand: command, command,
    argsPrefix: [], warnings: [], resolutionKind: availability === "absent" || (availability === "fallback" && command === "semgrep") ? "unavailable" : "direct" }));
  return vi.spyOn(commands, "runSecurityCommand").mockResolvedValue({ command: "semgrep", args: [], cwd: process.cwd(),
    exitCode: 0, timedOut: false, skipped: false, durationMs: 1, stdout: JSON.stringify(cleanOutput), stderr: "", ...overrides });
}
const scan = () => runSemgrepCheck({ targetRoot: process.cwd(), timeoutMs: 5000 });

// ---------------------------------------------------------------------------
// Static scan checks
//
// CodeQL local CLI and Semgrep are optional tools. These tests verify that:
//   - Unavailable tools produce a structured "skipped" result, not a crash.
//   - The result always conforms to SecurityCheckResult shape.
//   - Missing or malformed JSON evidence fails closed without throwing.
// ---------------------------------------------------------------------------

describe("CodeQL local availability preflight", () => {
  it("reports unavailable local CLI as skipped, never as full analysis", async () => {
    const result = await runCodeqlCheck({ cwd: process.cwd(), timeoutMs: 5000 });
    expect(["skipped", "passed", "failed", "warning"]).toContain(result.status);
    expect(result.id).toBe("codeql-scan");
    expect(result.category).toBe("static-scan");
    expect(Array.isArray(result.findings)).toBe(true);
    expect(result.startedAt).toBeTruthy();
    expect(result.finishedAt).toBeTruthy();
    if (result.status === "skipped") {
      expect(result.skippedReason).toMatch(/local CodeQL CLI is unavailable/i);
      expect(result.skippedReason).toMatch(/GitHub CodeQL advanced-setup analysis/i);
      expect(result.skippedReason).toMatch(/exact candidate SHA/i);
      expect(result.skippedReason).not.toMatch(/CodeQL.*passed/i);
    }
    if (result.status === "passed") {
      expect(result.name).toBe("CodeQL CLI availability preflight");
    }
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

  it("keeps local CLI absence non-blocking for this local preflight only", async () => {
    const result = await runCodeqlCheck({ cwd: process.cwd(), timeoutMs: 5000 });
    if (result.status === "skipped") {
      expect(result.findings).toHaveLength(0);
    }
  });
});

describe("Semgrep check — unavailable CLI", () => {
  it("returns a structured result (skipped or passed/warned/failed) regardless of tool availability", async () => {
    mockExecution({}, "absent");
    const result = await runSemgrepCheck({ targetRoot: process.cwd(), timeoutMs: 30_000 });
    expect(result.id).toBe("semgrep-scan");
    expect(result.category).toBe("static-scan");
    expect(["skipped", "passed", "failed", "warning"]).toContain(result.status);
    expect(Array.isArray(result.findings)).toBe(true);
    expect(result.startedAt).toBeTruthy();
    expect(result.finishedAt).toBeTruthy();
  }, 35000);

  it("skipped result has a skippedReason when tool is unavailable", async () => {
    mockExecution({}, "absent");
    const result = await runSemgrepCheck({ targetRoot: process.cwd(), timeoutMs: 30_000 });
    if (result.status === "skipped") {
      expect(typeof result.skippedReason).toBe("string");
      expect(result.skippedReason!.length).toBeGreaterThan(0);
    }
  }, 35000);
});

describe("parseSemgrepJson — unit tests", () => {
  it("rejects empty string as insufficient scan evidence", () => {
    const result = parseSemgrepJson("");
    expect(result.findings).toHaveLength(0);
    expect(result.parseError).toBeTruthy();
  });

  it("parses empty results array", () => {
    const result = parseSemgrepJson(JSON.stringify(cleanOutput));
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
      paths: { scanned: ["src/index.ts"] },
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
    expect(result.parseError).toBeTruthy();
  });

  it("handles null results field", () => {
    const result = parseSemgrepJson(JSON.stringify({ results: null }));
    expect(result.findings).toHaveLength(0);
    expect(result.parseError).toBeTruthy();
  });
});

describe("Semgrep execution evidence contract", () => {
  it("uses a bounded Windows Semgrep process allowance without changing shared tool budgets", async () => {
    expect(resolveSemgrepCommandTimeoutMs(DEFAULT_SECURITY_CONFIG, "win32")).toBe(300_000);
    expect(resolveSemgrepCommandTimeoutMs(DEFAULT_SECURITY_CONFIG, "linux")).toBe(60_000);
    expect(resolveSemgrepCommandTimeoutMs(DEFAULT_SECURITY_CONFIG, "darwin")).toBe(60_000);
    expect(resolveSemgrepCommandTimeoutMs({ commandTimeoutMs: 60_000, semgrepCommandTimeoutMs: 900_000 }, "win32")).toBe(300_000);
    expect(resolveSemgrepCommandTimeoutMs({ commandTimeoutMs: 60_000, semgrepCommandTimeoutMs: 5000 }, "win32")).toBe(5000);
    for (const invalid of [0, -1, Infinity, NaN]) {
      expect(() => resolveSemgrepCommandTimeoutMs({ commandTimeoutMs: 60_000, semgrepCommandTimeoutMs: invalid }, "win32")).toThrow(/positive finite/);
    }
    const command = mockExecution();
    const now = new Date().toISOString();
    const codeqlSpy = vi.spyOn(codeql, "runCodeqlCheck").mockResolvedValue({ id: "codeql-scan", name: "CodeQL", category: "static-scan",
      status: "skipped", severity: "skipped", startedAt: now, finishedAt: now, durationMs: 0, findings: [], skippedReason: "Optional tool unavailable" });
    await runSecurityValidation({ cwd: process.cwd(), selectedChecks: ["static"] });
    expect(command).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ timeoutMs: process.platform === "win32" ? 300_000 : 60_000 }));
    expect(codeqlSpy).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ timeoutMs: 60_000 }));
    expect(DEFAULT_SECURITY_CONFIG.commandTimeoutMs).toBe(60_000);
  });

  it("SG-01/14 passes only completed exit-0 clean scan evidence with the existing check ID", async () => {
    const command = mockExecution();
    expect(await scan()).toMatchObject({ id: "semgrep-scan", status: "passed", exitCode: 0, findings: [] });
    expect(command).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ command: "semgrep", cwd: process.cwd(),
      args: expect.arrayContaining(["scan", "--json", "--quiet"]) }));
  });

  it("SG-02/13 preserves findings and established ERROR/WARNING/INFO mappings on exit 1", async () => {
    mockExecution({ exitCode: 1, stdout: JSON.stringify({ ...cleanOutput, results: [finding("ERROR"), finding("WARNING"), finding("INFO")] }) });
    const result = await scan();
    expect(result.status).toBe("failed");
    expect(result.findings.map((item) => item.severity)).toEqual(["major", "minor", "informational"]);
    expect(result.findings.map((item) => item.affectedFiles)).toEqual([["src/index.ts:10"], ["src/index.ts:10"], ["src/index.ts:10"]]);
  });

  it("preserves arbitrary rule metadata and the existing severity fallback", async () => {
    mockExecution({ stdout: JSON.stringify({ ...cleanOutput, results: [
      { ...finding(), extra: { severity: "ERROR", metadata: { severity: 5 } } },
      { ...finding(), extra: { metadata: { severity: "WARNING" } } },
    ] }) });
    const result = await scan();
    expect(result.findings.map((item) => item.severity)).toEqual(["major", "minor"]);
    expect(result.findings).toHaveLength(2);
  });

  it.each([
    ["SG-03", { exitCode: 1, stdout: "" }],
    ["SG-04", { exitCode: 0, stdout: "" }],
    ["SG-05", { exitCode: 2 }], ["SG-05", { exitCode: 7, stdout: "" }],
    ["SG-06", { exitCode: null, stderr: "spawn ENOENT" }],
    ["SG-06", { exitCode: null, stderr: "Command was not found on PATH" }],
    ["SG-07", { timedOut: true }],
    ["SG-08", { stdout: "{truncated" }],
    ["SG-09", { stdout: JSON.stringify({ errors: [], paths: cleanOutput.paths }) }],
    ["SG-10", { stdout: JSON.stringify({ ...cleanOutput, results: {} }) }],
    ["SG-10", { stdout: JSON.stringify({ ...cleanOutput, results: null }) }],
    ["SG-11", { stdout: JSON.stringify({ ...cleanOutput, errors: [{ code: 2, level: "error", type: "FatalError", message: "analysis failed" }] }) }],
    ["SG-11", { stdout: JSON.stringify({ ...cleanOutput, errors: [{ code: 3, level: "warn", type: "ParseError", message: "partial analysis" }] }) }],
    ["inconsistent exit 1", { exitCode: 1 }],
    ["skipped without evidence", { skipped: true, exitCode: null, stdout: "" }],
    ["skipped for unrelated reason", { skipped: true, exitCode: null, stdout: "", skippedReason: "Network unavailable" }],
    ["missing error structure", { stdout: JSON.stringify({ results: [], paths: cleanOutput.paths }) }],
    ["malformed error structure", { stdout: JSON.stringify({ ...cleanOutput, errors: null }) }],
    ["missing scanned paths", { stdout: JSON.stringify({ results: [], errors: [] }) }],
    ["malformed scanned paths", { stdout: JSON.stringify({ ...cleanOutput, paths: { scanned: 4 } }) }],
    ["malformed result entry", { stdout: JSON.stringify({ ...cleanOutput, results: [null] }) }],
    ["malformed severity", { stdout: JSON.stringify({ ...cleanOutput, results: [{ ...finding(), extra: { severity: 5 } }] }) }],
    ["malformed severity with metadata fallback", { stdout: JSON.stringify({ ...cleanOutput, results: [{ ...finding(), extra: { severity: 5, metadata: { severity: "ERROR" } } }] }) }],
    ["empty severity", { stdout: JSON.stringify({ ...cleanOutput, results: [finding("")] }) }],
    ["malformed line", { stdout: JSON.stringify({ ...cleanOutput, results: [{ ...finding(), start: { line: "10" } }] }) }],
    ["wrong JSON root", { stdout: "[]" }],
  ] as const)("%s never returns PASS: %j", async (_responsibility, outcome) => {
    mockExecution(outcome);
    const result = await scan();
    expect(result).toMatchObject({ id: "semgrep-scan", status: "failed", severity: "major" });
    expect(result.findings.some((item) => item.severity === "major")).toBe(true);
  });

  it("SG-06 returns failed scan evidence when the command runner rejects", async () => {
    mockExecution().mockRejectedValue(new Error("spawn failed"));
    expect(await scan()).toMatchObject({ id: "semgrep-scan", status: "failed", exitCode: null });
  });

  it.each([2, 0])("retains valid security findings alongside incomplete execution/analysis evidence (exit %s)", async (exitCode) => {
    mockExecution({ exitCode, stdout: JSON.stringify({ ...cleanOutput, results: [finding()],
      errors: [{ type: "Timeout", message: "incomplete analysis" }] }) });
    const result = await scan();
    expect(result.status).toBe("failed");
    expect(result.findings[0].title).toBe("rule-ERROR");
    expect(result.findings).toHaveLength(2);
  });

  it("retains valid matches when another result is malformed", async () => {
    mockExecution({ stdout: JSON.stringify({ ...cleanOutput, results: [finding(), null] }) });
    const result = await scan();
    expect(result.status).toBe("failed");
    expect(result.findings[0].title).toBe("rule-ERROR");
    expect(result.findings[1].id).toBe("semgrep-parse-error");
  });

  it("SG-12 skips absence before execution when neither supported command is available", async () => {
    const command = mockExecution({}, "absent");
    const result = await scan();
    expect(result.status).toBe("skipped");
    expect(result.skippedReason).toBeTruthy();
    expect(command).not.toHaveBeenCalled();
  });

  it("SG-12 recognizes positive npx executable-unavailability evidence without a false pass", async () => {
    mockExecution({ exitCode: 1, stdout: "", stderr: "npm error could not determine executable to run" }, "fallback");
    expect(await scan()).toMatchObject({ status: "skipped", skippedReason: expect.stringContaining("no executable") });
  });

  it("SG-12 preserves a command runner's explicitly established scanner absence", async () => {
    mockExecution({ skipped: true, exitCode: null, stdout: "", skippedReason: "Semgrep CLI is unavailable" });
    expect(await scan()).toMatchObject({ status: "skipped", skippedReason: "Semgrep CLI is unavailable" });
  });

  it("does not misclassify fallback network errors as scanner absence", async () => {
    mockExecution({ exitCode: 1, stdout: "", stderr: "npm error ECONNRESET" }, "fallback");
    expect((await scan()).status).toBe("failed");
  });

  it.each(["failed", "skipped"] as const)("SG-15/16 full runner and JSON report preserve actual Semgrep %s", async (status) => {
    mockExecution(status === "failed" ? { exitCode: 1, stdout: "" } : {}, status === "skipped" ? "absent" : "native");
    const now = new Date().toISOString();
    vi.spyOn(codeql, "runCodeqlCheck").mockResolvedValue({ id: "codeql-scan", name: "CodeQL", category: "static-scan",
      status: "skipped", severity: "skipped", startedAt: now, finishedAt: now, durationMs: 0, findings: [], skippedReason: "Controlled optional tool unavailable" });
    const summary = await runSecurityValidation({ cwd: process.cwd(), selectedChecks: ["static"] });
    const actual = summary.checks.find((item) => item.id === "semgrep-scan");
    expect(actual?.status).toBe(status);
    const json = JSON.parse(renderJsonReport(buildSecurityReportFromSummary(summary)));
    expect(json.checks.find((item: { id: string }) => item.id === "semgrep-scan").status).toBe(status);
    expect(json.metadata.targetRoot).toBe(process.cwd());
    if (status === "failed") expect(json.findings.some((item: { id: string }) => item.id === "semgrep-execution-error")).toBe(true);
    else expect(actual?.skippedReason).toBeTruthy();
  });
});
