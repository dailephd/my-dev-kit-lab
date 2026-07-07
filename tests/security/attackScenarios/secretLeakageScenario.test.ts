import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SECRET_LEAKAGE_SCENARIO } from "../../../src/securityValidation/attackScenarios/scenarios/secretLeakageScenario.js";
import { renderJsonReport, renderTextReport } from "../../../src/securityValidation/report/renderSecurityReport.js";
import type { SecurityReport } from "../../../src/securityValidation/report/securityReportTypes.js";
import { toSecurityCheckResult } from "../../../src/securityValidation/attackScenarios/attackResult.js";
import { DEFAULT_SECURITY_CONFIG } from "../../../src/securityValidation/config.js";
import type { SecurityValidationTarget } from "../../../src/securityValidation/validate/resolveTarget.js";
import type { AttackScenarioContext } from "../../../src/securityValidation/attackScenarios/attackScenario.js";

function fakeTarget(targetRoot: string): SecurityValidationTarget {
  return {
    targetRoot,
    toolRoot: targetRoot,
    packageName: "fixture",
    packageVersion: "1.0.0",
    hasPackageJson: true,
    hasSecurityTestScript: false,
    hasLockfile: false,
    branch: "main",
    commit: "abc",
    hasGit: false,
    isSelf: true,
  };
}

function makeCtx(targetRoot: string): AttackScenarioContext {
  return {
    toolRoot: targetRoot,
    target: fakeTarget(targetRoot),
    profile: "node-cli-package",
    config: DEFAULT_SECURITY_CONFIG,
  };
}

const cleanupDirs: string[] = [];
afterEach(async () => {
  await Promise.all(cleanupDirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

function makeFixtureDir(prefix: string): string {
  const root = mkdtempSync(path.join(os.tmpdir(), prefix));
  mkdirSync(path.join(root, "src"), { recursive: true });
  cleanupDirs.push(root);
  return root;
}

describe("SECRET_LEAKAGE_SCENARIO", () => {
  it("a high-confidence private key fixture produces a finding (failed)", async () => {
    const root = makeFixtureDir("secret-privkey-");
    writeFileSync(
      path.join(root, "src", "creds.ts"),
      "export const key = `-----BEGIN PRIVATE KEY-----\nZmFrZWtleWRhdGE=\n-----END PRIVATE KEY-----`;\n",
      "utf8"
    );
    const outcome = await SECRET_LEAKAGE_SCENARIO.run(makeCtx(root));
    expect(outcome.status).toBe("failed");
    expect(outcome.severity).toBe("blocker");
    expect(outcome.evidence.some((e) => e.kind === "secret-leak")).toBe(true);
  });

  it("a high-confidence token fixture (GitHub-style) produces a finding (failed)", async () => {
    const root = makeFixtureDir("secret-token-");
    writeFileSync(
      path.join(root, "src", "config.ts"),
      'export const token = "ghp_abcdefghijklmnopqrstuvwxyz0123456789";\n',
      "utf8"
    );
    const outcome = await SECRET_LEAKAGE_SCENARIO.run(makeCtx(root));
    expect(outcome.status).toBe("failed");
    expect(outcome.severity).toBe("blocker");
  });

  it("secret values are redacted in AttackResult evidence", async () => {
    const root = makeFixtureDir("secret-redact-evidence-");
    const rawSecret = "ghp_abcdefghijklmnopqrstuvwxyz0123456789";
    writeFileSync(path.join(root, "src", "config.ts"), `export const token = "${rawSecret}";\n`, "utf8");
    const outcome = await SECRET_LEAKAGE_SCENARIO.run(makeCtx(root));
    const leakEvidence = outcome.evidence.find((e) => e.kind === "secret-leak");
    expect(leakEvidence).toBeDefined();
    expect(leakEvidence!.redactedPreview).not.toContain(rawSecret);
  });

  it("secret values are redacted in JSON report output", async () => {
    const root = makeFixtureDir("secret-redact-json-");
    const rawSecret = "ghp_abcdefghijklmnopqrstuvwxyz0123456789";
    writeFileSync(path.join(root, "src", "config.ts"), `export const token = "${rawSecret}";\n`, "utf8");
    const outcome = await SECRET_LEAKAGE_SCENARIO.run(makeCtx(root));
    const now = new Date().toISOString();
    const report: SecurityReport = {
      metadata: {
        toolRoot: root,
        toolPackageName: "fixture",
        toolPackageVersion: "1.0.0",
        targetRoot: root,
        targetDescription: "self",
        packageName: "fixture",
        packageVersion: "1.0.0",
        branch: "main",
        commit: "abc",
        isSelf: true,
        generatedAt: now,
        totalDurationMs: 1,
      },
      sections: [],
      allChecks: [],
      allFindings: [],
      verdict: "not-ready-security-blocker-remains",
      recommendedNextStep: "fix",
      attackResults: [
        {
          scenarioId: SECRET_LEAKAGE_SCENARIO.id,
          scenarioTitle: SECRET_LEAKAGE_SCENARIO.title,
          checkId: "secrets",
          profileId: "node-cli-package",
          status: outcome.status,
          severity: outcome.severity ?? "blocker",
          confidence: outcome.confidence,
          evidence: outcome.evidence,
          category: "secret-leakage",
          recommendation: outcome.recommendation,
        },
      ],
    };
    const json = renderJsonReport(report);
    expect(json).not.toContain(rawSecret);
  });

  it("secret values are redacted in text report output", async () => {
    const root = makeFixtureDir("secret-redact-text-");
    const rawSecret = "ghp_abcdefghijklmnopqrstuvwxyz0123456789";
    writeFileSync(path.join(root, "src", "config.ts"), `export const token = "${rawSecret}";\n`, "utf8");
    const outcome = await SECRET_LEAKAGE_SCENARIO.run(makeCtx(root));
    const check = toSecurityCheckResult({
      scenarioId: SECRET_LEAKAGE_SCENARIO.id,
      scenarioTitle: SECRET_LEAKAGE_SCENARIO.title,
      checkId: "secrets",
      profileId: "node-cli-package",
      status: outcome.status,
      severity: outcome.severity ?? "blocker",
      confidence: outcome.confidence,
      evidence: outcome.evidence,
      category: "secret-leakage",
      recommendation: outcome.recommendation,
    });
    expect(check.findings[0]?.evidence ?? "").not.toContain(rawSecret);
  });

  it("placeholder values do not produce high-confidence findings", async () => {
    const root = makeFixtureDir("secret-placeholder-");
    writeFileSync(
      path.join(root, "src", "config.example.ts"),
      'export const apiKey = "your-api-key-here-example-placeholder";\n' + 'export const token = "changeme_dummy_test_fake_value";\n',
      "utf8"
    );
    const outcome = await SECRET_LEAKAGE_SCENARIO.run(makeCtx(root));
    expect(outcome.status).toBe("passed");
  });

  it("environment variable names without literal values do not produce high-confidence findings", async () => {
    const root = makeFixtureDir("secret-envname-");
    writeFileSync(
      path.join(root, "src", "config.ts"),
      "export const apiKey = process.env.API_KEY;\nexport const token = process.env.SECRET_TOKEN;\n",
      "utf8"
    );
    const outcome = await SECRET_LEAKAGE_SCENARIO.run(makeCtx(root));
    expect(outcome.status).toBe("passed");
  });

  it("skips node_modules, dist, coverage, and .git nested under the scanned src/ tree", async () => {
    const root = makeFixtureDir("secret-excluded-dirs-");
    for (const dir of ["node_modules", "dist", "coverage", ".git"]) {
      const full = path.join(root, "src", dir);
      mkdirSync(full, { recursive: true });
      writeFileSync(path.join(full, "leak.ts"), 'export const token = "ghp_abcdefghijklmnopqrstuvwxyz0123456789";\n', "utf8");
    }
    const outcome = await SECRET_LEAKAGE_SCENARIO.run(makeCtx(root));
    expect(outcome.status).toBe("passed");
  });

  it("skips top-level lab-output/ and reports/security/ (outside the bounded glob surface entirely)", async () => {
    const root = makeFixtureDir("secret-excluded-toplevel-");
    for (const dir of ["lab-output", path.join("reports", "security")]) {
      const full = path.join(root, dir);
      mkdirSync(full, { recursive: true });
      writeFileSync(path.join(full, "leak.ts"), 'export const token = "ghp_abcdefghijklmnopqrstuvwxyz0123456789";\n', "utf8");
    }
    const outcome = await SECRET_LEAKAGE_SCENARIO.run(makeCtx(root));
    expect(outcome.status).toBe("passed");
  });

  it("a target with no scan-worthy files passes with clear bounded-scan wording", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "secret-empty-"));
    cleanupDirs.push(root);
    const outcome = await SECRET_LEAKAGE_SCENARIO.run(makeCtx(root));
    expect(outcome.status).toBe("passed");
    expect(outcome.evidence.some((e) => e.observedBehavior?.includes("nothing to scan"))).toBe(true);
  });
});
