import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { normalizeAuditConfig } from "../../src/audits/core/auditConfig.js";
import { runAudit } from "../../src/audits/core/auditRunner.js";
import { buildAuditReportModel } from "../../src/audits/report/auditReportModel.js";
import { renderAuditJsonReport } from "../../src/audits/report/renderAuditJsonReport.js";
import { renderAuditTextReport } from "../../src/audits/report/renderAuditTextReport.js";
import { ANDROID_SECURITY_AUDIT_DETECTOR_ID } from "../../src/audits/security/mapAndroidSecurityFindingToAuditIssue.js";
import { validateAndroidTarget } from "../../src/mobile/android/validate/validateAndroidTarget.js";
import { resolveCommand } from "../../src/core/resolveCommand.js";
import { resolveAuditTarget } from "../../src/audits/core/auditTarget.js";
import type { AuditIssue } from "../../src/audits/core/auditIssue.js";

// ---------------------------------------------------------------------------
// v0.4.2 Batch 3 -- runner wiring, JSON/text report integration, text/JSON
// parity, and the end-to-end fixture matrix (spec section 17) for the
// --android audit CLI opt-in. Uses direct runAudit()/buildAuditReportModel()
// calls against real Android fixtures (fast, real code paths, no subprocess
// overhead) for the fixture matrix, and a small number of real `npm run
// audit` subprocess invocations for genuine CLI-level smokes (help, invalid
// combination) -- see the final describe block.
// ---------------------------------------------------------------------------

const cleanupDirs: string[] = [];
afterEach(async () => {
  for (const dir of cleanupDirs.splice(0)) {
    await fs.promises.rm(dir, { recursive: true, force: true });
  }
});

function makeTempToolRoot(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "android-audit-cli-tool-"));
  cleanupDirs.push(dir);
  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "@dailephd/my-dev-kit-lab", version: "0.4.1" }, null, 2), "utf8");
  return dir;
}

const FIXTURE = (name: string) => path.resolve("tests/fixtures/android", name);

async function runAndroidAudit(toolRoot: string, targetPathArg: string | undefined, android: boolean) {
  const config = normalizeAuditConfig({ target: targetPathArg, types: "security", android: android ? true : undefined }, toolRoot);
  const target = resolveAuditTarget(config.targetPathArg, toolRoot);
  const result = await runAudit({ config, toolRoot, target });
  const model = buildAuditReportModel(result, { target });
  return { result, model, json: JSON.parse(renderAuditJsonReport(model)), text: renderAuditTextReport(model) };
}

function androidIssues(issues: readonly AuditIssue[]): AuditIssue[] {
  return issues.filter((i) => i.detectorId === ANDROID_SECURITY_AUDIT_DETECTOR_ID);
}

describe("runAudit — Android runner wiring (18.2)", () => {
  it("leaves androidSummary not-requested and never touches the validator when --android is omitted", async () => {
    const toolRoot = makeTempToolRoot();
    const { result } = await runAndroidAudit(toolRoot, undefined, false);
    expect(result.androidSummary.requested).toBe(false);
    expect(result.androidSummary.status).toBe("not-requested");
    expect(androidIssues(result.issues)).toHaveLength(0);
  });

  it("invokes the real Android validator exactly once when --android is present", async () => {
    const toolRoot = makeTempToolRoot();
    const runAndroidValidationSpy = { calls: 0, fn: validateAndroidTarget };
    const wrapped = (opts: Parameters<typeof validateAndroidTarget>[0]) => {
      runAndroidValidationSpy.calls += 1;
      return validateAndroidTarget(opts);
    };
    const config = normalizeAuditConfig({ target: FIXTURE("library"), types: "security", android: true }, toolRoot);
    const target = resolveAuditTarget(config.targetPathArg, toolRoot);
    const result = await runAudit({
      config,
      toolRoot,
      target,
      securityDependencies: { runAndroidValidation: wrapped },
    });

    expect(runAndroidValidationSpy.calls).toBe(1);
    expect(result.androidSummary.requested).toBe(true);
    expect(result.androidSummary.status).toBe("completed");
  });

  it("isolates a thrown Android validator failure: existing audit still completes, no Android issues are synthesized", async () => {
    const toolRoot = makeTempToolRoot();
    const config = normalizeAuditConfig({ types: "security", android: true }, toolRoot);
    const target = resolveAuditTarget(config.targetPathArg, toolRoot);
    const result = await runAudit({
      config,
      toolRoot,
      target,
      securityDependencies: { runAndroidValidation: async () => { throw new Error("boom: injected Android validator failure"); } },
    });

    expect(result.androidSummary.status).toBe("failed");
    expect(result.androidSummary.errors[0]).toContain("injected Android validator failure");
    expect(androidIssues(result.issues)).toHaveLength(0);
    expect(result.exitCode).toBeDefined();
  });
});

describe("JSON rendering — androidSecurity field (18.3)", () => {
  it("requested/completed: includes status, verdict, counts, and report paths", async () => {
    const toolRoot = makeTempToolRoot();
    const { json } = await runAndroidAudit(toolRoot, FIXTURE("xml-view-app"), true);

    expect(json.androidSecurity.summary.requested).toBe(true);
    expect(json.androidSecurity.summary.status).toBe("completed");
    expect(json.androidSecurity.summary.applicable).toBe(true);
    expect(typeof json.androidSecurity.summary.verdict).toBe("string");
    expect(json.androidSecurity.summary.totalChecks).toBe(19);
    expect(json.androidSecurity.summary.reportPaths.text).toBeTruthy();
    expect(json.androidSecurity.summary.reportPaths.json).toBeTruthy();
  });

  it("candidate-only: zero mapped issues from candidates, nonzero candidate summary", async () => {
    const toolRoot = makeTempToolRoot();
    const { json, result } = await runAndroidAudit(toolRoot, FIXTURE("library"), true);

    expect(json.androidSecurity.summary.confirmedFindingCount).toBe(0);
    expect(json.androidSecurity.summary.mappedIssueCount).toBe(0);
    expect(androidIssues(result.issues)).toHaveLength(0);
    expect(json.androidSecurity.candidates.totalCount).toBeGreaterThan(0);
  });

  it("failed: status failed, bounded errors, no stack trace", async () => {
    const toolRoot = makeTempToolRoot();
    const config = normalizeAuditConfig({ types: "security", android: true }, toolRoot);
    const target = resolveAuditTarget(config.targetPathArg, toolRoot);
    const result = await runAudit({
      config,
      toolRoot,
      target,
      securityDependencies: { runAndroidValidation: async () => { throw new Error("synthetic failure"); } },
    });
    const model = buildAuditReportModel(result, { target });
    const json = JSON.parse(renderAuditJsonReport(model));

    expect(json.androidSecurity.summary.status).toBe("failed");
    expect(json.androidSecurity.summary.errors.length).toBeGreaterThan(0);
    expect(json.androidSecurity.summary.errors[0]).not.toContain(" at ");
  });

  it("not applicable: applicable false, no Android issues, existing fields unchanged", async () => {
    const toolRoot = makeTempToolRoot();
    const { json, result } = await runAndroidAudit(toolRoot, FIXTURE("non-android-gradle"), true);

    expect(json.androidSecurity.summary.status).toBe("completed");
    expect(json.androidSecurity.summary.applicable).toBe(false);
    expect(androidIssues(result.issues)).toHaveLength(0);
    expect(json.schemaVersion).toBe("1.0");
    expect(json.summary).toBeDefined();
  });

  it("confirmed Android findings appear exactly once in the top-level issues collection, never duplicated inside androidSecurity", async () => {
    const toolRoot = makeTempToolRoot();
    const { json } = await runAndroidAudit(toolRoot, FIXTURE("xml-view-app"), true);
    const androidIssuesInCollection = (json.issues as { detectorId: string }[]).filter((i) => i.detectorId === ANDROID_SECURITY_AUDIT_DETECTOR_ID);

    expect(androidIssuesInCollection.length).toBe(json.androidSecurity.summary.mappedIssueCount);
    expect(JSON.stringify(json.androidSecurity)).not.toContain('"resolutionState"');
  });
});

describe("Text rendering — Android security validation summary section (18.4)", () => {
  it("shows a not-requested placeholder when --android is omitted", async () => {
    const toolRoot = makeTempToolRoot();
    const { text } = await runAndroidAudit(toolRoot, undefined, false);
    expect(text).toContain("Android security validation summary");
    expect(text).toContain("(not requested -- add --android alongside --types security to include it)");
  });

  it("shows status/verdict/checks/candidates and does not duplicate mapped issue details", async () => {
    const toolRoot = makeTempToolRoot();
    const { text, result } = await runAndroidAudit(toolRoot, FIXTURE("xml-view-app"), true);

    expect(text).toContain("Android security validation summary");
    expect(text).toContain("Status: completed");
    expect(text).toMatch(/Checks: total=19/);
    expect(text).toContain("Candidates (review evidence, not confirmed vulnerabilities):");
    expect(text).toContain("Static analysis only");

    // The Android section itself must not re-list each mapped issue's full
    // block (title+severity+evidence) -- that detail lives only in the
    // "Issues" section below, once per issue.
    const androidSectionOnly = text.slice(text.indexOf("Android security validation summary"), text.indexOf("Issue summary"));
    const mappedIssues = androidIssues(result.issues);
    for (const issue of mappedIssues) {
      expect(androidSectionOnly).not.toContain(issue.id);
    }
  });

  it("labels candidate-only evidence as review evidence, never as a vulnerability", async () => {
    const toolRoot = makeTempToolRoot();
    const { text } = await runAndroidAudit(toolRoot, FIXTURE("library"), true);
    expect(text).toContain("Candidates (review evidence, not confirmed vulnerabilities): total=");
    expect(text).not.toMatch(/candidate.*vulnerability/i);
  });

  it("shows a non-applicable target honestly, never as passed", async () => {
    const toolRoot = makeTempToolRoot();
    const { text } = await runAndroidAudit(toolRoot, FIXTURE("non-android-gradle"), true);
    expect(text).toContain("Status: completed (target is not an Android project)");
  });

  it("shows failure wording, not a false clean-complete state", async () => {
    const toolRoot = makeTempToolRoot();
    const config = normalizeAuditConfig({ types: "security", android: true }, toolRoot);
    const target = resolveAuditTarget(config.targetPathArg, toolRoot);
    const result = await runAudit({
      config,
      toolRoot,
      target,
      securityDependencies: { runAndroidValidation: async () => { throw new Error("synthetic failure for text rendering"); } },
    });
    const model = buildAuditReportModel(result, { target });
    const text = renderAuditTextReport(model);

    expect(text).toContain("Status: failed");
    expect(text).toContain("Errors: 1");
    expect(text).toContain("synthetic failure for text rendering");
  });

  it("references the Android report path without embedding the full report", async () => {
    const toolRoot = makeTempToolRoot();
    const { text } = await runAndroidAudit(toolRoot, FIXTURE("xml-view-app"), true);
    expect(text).toMatch(/Full report: .*android-security-validation\.txt/);
    // The Android section must stay short -- it is not a second copy of the
    // full Android report (which is much longer and includes per-manifest
    // detail, Play-readiness checklist items, etc.).
    const section = text.slice(text.indexOf("Android security validation summary"), text.indexOf("Issue summary"));
    expect(section.split("\n").length).toBeLessThan(20);
  });
});

describe("Text/JSON parity (18.5)", () => {
  it("agrees on status, verdict, checks, findings, mapped issues, candidates, and report references", async () => {
    const toolRoot = makeTempToolRoot();
    const { json, text } = await runAndroidAudit(toolRoot, FIXTURE("xml-view-app"), true);
    const s = json.androidSecurity.summary;

    expect(text).toContain(`Status: ${s.status}`);
    expect(text).toContain(`Verdict: ${s.verdict}`);
    expect(text).toContain(`total=${s.totalChecks}`);
    expect(text).toContain(`confirmed=${s.confirmedFindingCount} mappedIssues=${s.mappedIssueCount}`);
    expect(text).toContain(`total=${json.androidSecurity.candidates.totalCount}`);
    expect(text).toContain(s.reportPaths.text);
  });
});

describe("End-to-end Android audit fixture matrix (spec section 17)", () => {
  it("17.1 -- --android omitted: no Android validation, no Android report, existing behavior unchanged", async () => {
    const toolRoot = makeTempToolRoot();
    const { result } = await runAndroidAudit(toolRoot, undefined, false);
    expect(result.androidSummary.requested).toBe(false);
    expect(fs.existsSync(path.join(toolRoot, "reports", "security", "android"))).toBe(false);
  });

  it("17.2 -- safe Android library fixture: applicable, completed, reports written, no candidate-to-issue mapping", async () => {
    const toolRoot = makeTempToolRoot();
    const { result, json } = await runAndroidAudit(toolRoot, FIXTURE("library"), true);
    expect(result.androidSummary.applicable).toBe(true);
    expect(result.androidSummary.status).toBe("completed");
    expect(androidIssues(result.issues)).toHaveLength(0);
    expect(fs.existsSync(json.androidSecurity.summary.reportPaths.text)).toBe(true);
    expect(fs.existsSync(json.androidSecurity.summary.reportPaths.json)).toBe(true);
  });

  it("17.3 -- risky Android app fixture: confirmed findings map to generic issues with severity/blocking policy applied", async () => {
    const toolRoot = makeTempToolRoot();
    const { result, json } = await runAndroidAudit(toolRoot, FIXTURE("xml-view-app"), true);
    const mapped = androidIssues(result.issues);
    expect(mapped.length).toBeGreaterThan(0);
    expect(mapped.length).toBe(json.androidSecurity.summary.mappedIssueCount);
    for (const issue of mapped) {
      expect(typeof issue.releaseBlocking).toBe("boolean");
      expect(typeof issue.implementationBlocking).toBe("boolean");
    }
    expect(json.androidSecurity.summary.reportPaths.text).toBeTruthy();
  });

  it("17.4 -- candidate-only fixture: zero confirmed mapped issues, nonzero candidates, review-evidence wording", async () => {
    const toolRoot = makeTempToolRoot();
    const { result, text } = await runAndroidAudit(toolRoot, FIXTURE("library"), true);
    expect(androidIssues(result.issues)).toHaveLength(0);
    expect(result.androidSummary.candidateSummary.totalCount).toBeGreaterThan(0);
    expect(text).toContain("review evidence, not confirmed vulnerabilities");
  });

  it("17.5 -- partial/incomplete Android fixture: incomplete state visible, never called clean, generic report still written", async () => {
    const toolRoot = makeTempToolRoot();
    const { result, json } = await runAndroidAudit(toolRoot, FIXTURE("partial"), true);
    expect(result.androidSummary.status).toBe("completed");
    expect(result.androidSummary.verdict).not.toBe("ready-for-release-preparation");
    expect(result.androidSummary.verdict).not.toBe("ready-except-optional-manual-checks");
    expect(json.summary).toBeDefined();
    expect(json.exit).toBeDefined();
  });

  it("17.6 -- non-Android fixture with Android requested: applicable false, no false pass, existing issues preserved", async () => {
    const toolRoot = makeTempToolRoot();
    const { result } = await runAndroidAudit(toolRoot, FIXTURE("non-android-gradle"), true);
    expect(result.androidSummary.applicable).toBe(false);
    expect(androidIssues(result.issues)).toHaveLength(0);
    expect(result.exitCode).toBe(0);
  });

  it("17.7 -- injected validator failure: generic audit survives, status failed, bounded error, reports remain renderable", async () => {
    const toolRoot = makeTempToolRoot();
    const config = normalizeAuditConfig({ types: "security", android: true }, toolRoot);
    const target = resolveAuditTarget(config.targetPathArg, toolRoot);
    const result = await runAudit({
      config,
      toolRoot,
      target,
      securityDependencies: { runAndroidValidation: async () => { throw new Error("17.7 injected failure"); } },
    });
    const model = buildAuditReportModel(result, { target });
    expect(() => renderAuditJsonReport(model)).not.toThrow();
    expect(() => renderAuditTextReport(model)).not.toThrow();
    expect(result.androidSummary.status).toBe("failed");
  });

  it("17.8 -- repeated deterministic run: same mapped issue IDs, order, and summary counts", async () => {
    const toolRoot = makeTempToolRoot();
    const first = await runAndroidAudit(toolRoot, FIXTURE("xml-view-app"), true);
    const second = await runAndroidAudit(toolRoot, FIXTURE("xml-view-app"), true);

    const firstIds = androidIssues(first.result.issues).map((i) => i.id);
    const secondIds = androidIssues(second.result.issues).map((i) => i.id);
    expect(secondIds).toEqual(firstIds);
    expect(second.json.androidSecurity.summary.totalChecks).toBe(first.json.androidSecurity.summary.totalChecks);
    expect(second.json.androidSecurity.summary.mappedIssueCount).toBe(first.json.androidSecurity.summary.mappedIssueCount);
    expect(second.json.androidSecurity.summary.reportPaths.text).toBe(first.json.androidSecurity.summary.reportPaths.text);
  });

  it("does not modify any Android fixture used in this matrix", async () => {
    const fixtures = ["library", "xml-view-app", "partial", "non-android-gradle"];
    const before = fixtures.map((f) => JSON.stringify(fs.readdirSync(FIXTURE(f), { recursive: true } as never)));
    const toolRoot = makeTempToolRoot();
    for (const f of fixtures) {
      await runAndroidAudit(toolRoot, FIXTURE(f), true);
    }
    const after = fixtures.map((f) => JSON.stringify(fs.readdirSync(FIXTURE(f), { recursive: true } as never)));
    expect(after).toEqual(before);
  }, 60_000);
});

describe("Real nineteen-check deterministic uniqueness regression (spec section 16)", () => {
  it("produces unique AuditIssue IDs with non-Android issues first, then Android issues in check/finding order", async () => {
    const toolRoot = makeTempToolRoot();
    const { result } = await runAndroidAudit(toolRoot, FIXTURE("xml-view-app"), true);

    const ids = result.issues.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);

    const firstAndroidIndex = result.issues.findIndex((i) => i.detectorId === ANDROID_SECURITY_AUDIT_DETECTOR_ID);
    const lastNonAndroidIndex = result.issues.reduce((last, i, idx) => (i.detectorId !== ANDROID_SECURITY_AUDIT_DETECTOR_ID ? idx : last), -1);
    if (firstAndroidIndex !== -1 && lastNonAndroidIndex !== -1) {
      expect(firstAndroidIndex).toBeGreaterThan(lastNonAndroidIndex);
    }
  });
});

describe("Real CLI smokes (help and invalid combination -- spec section 22)", () => {
  const toolRoot = process.cwd();

  function runAuditCli(args: string[]): { stdout: string; stderr: string; status: number } {
    const resolved = resolveCommand("npx", { cwd: toolRoot });
    const needsResolvedPathArg =
      resolved.resolutionKind === "windows-cmd-shim" || resolved.resolutionKind === "windows-powershell-shim";
    const fullArgs = [
      ...resolved.argsPrefix,
      ...(needsResolvedPathArg && resolved.resolvedPath ? [resolved.resolvedPath] : []),
      "tsx",
      "scripts/audits/runAudit.ts",
      ...args,
    ];
    try {
      const stdout = execFileSync(resolved.command, fullArgs, { cwd: toolRoot, encoding: "utf8" });
      return { stdout, stderr: "", status: 0 };
    } catch (err) {
      const e = err as { stdout?: string; stderr?: string; status?: number };
      return { stdout: e.stdout ?? "", stderr: e.stderr ?? "", status: e.status ?? 1 };
    }
  }

  it("--help documents --android, exits 0, and runs no audit", () => {
    const before = fs.existsSync(path.join(toolRoot, "reports", "audits"));
    const result = runAuditCli(["--help"]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("--android");
    expect(result.stdout.toLowerCase()).toContain("static");
    // Help must not have produced a fresh report directory as a side effect
    // beyond whatever already existed before this test ran.
    expect(fs.existsSync(path.join(toolRoot, "reports", "audits"))).toBe(before);
  }, 30_000);

  it("-h behaves identically to --help", () => {
    const result = runAuditCli(["-h"]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("--android");
  }, 30_000);

  it("rejects --android without --types including security, before any execution, with the existing invalid-input exit code", () => {
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "android-audit-invalid-out-"));
    cleanupDirs.push(outDir);
    const result = runAuditCli(["--android", "--types", "code-rot", "--fail-on", "none", "--out", outDir]);
    expect(result.status).toBe(2);
    expect(result.stderr).toMatch(/--android requires --types to include "security"/);
    expect(fs.readdirSync(outDir)).toHaveLength(0);
  }, 30_000);

  it("runs a real Android audit against compose-app and writes both generic and Android reports", () => {
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "android-audit-real-out-"));
    cleanupDirs.push(outDir);
    const result = runAuditCli([
      "--target",
      FIXTURE("compose-app"),
      "--types",
      "security",
      "--android",
      "--format",
      "text,json",
      "--fail-on",
      "none",
      "--out",
      outDir,
    ]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Android security validation:");
    const jsonPath = path.join(outDir, "code-rot-audit.json");
    expect(fs.existsSync(jsonPath)).toBe(true);
    const parsed = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
    expect(parsed.androidSecurity.summary.requested).toBe(true);
    expect(parsed.androidSecurity.summary.totalChecks).toBe(19);
  }, 60_000);
});
