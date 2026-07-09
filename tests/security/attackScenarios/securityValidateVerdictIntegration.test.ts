import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runSecurityValidation } from "../../../src/securityValidation/validate/runSecurityValidation.js";
import {
  parseSecurityValidateArgs,
  normalizeSecurityValidateConfig,
  applyProfileDefaultChecksIfApplicable,
} from "../../../src/securityValidation/validate/cliOptions.js";
import { resolveAttackProfile } from "../../../src/securityValidation/attackScenarios/attackProfile.js";
import { findingsBreachFailOnThreshold } from "../../../src/securityValidation/validate/verdict.js";

const toolRoot = process.cwd();

function buildEffectiveConfig(argv: string[]) {
  const args = parseSecurityValidateArgs(argv);
  let config = normalizeSecurityValidateConfig(args, toolRoot);
  config = applyProfileDefaultChecksIfApplicable(config, resolveAttackProfile(config.profile).defaultCheckIds);
  return config;
}

describe("profile-aware default checks (Batch 5)", () => {
  it("no --profile and no --checks preserves current default behavior", () => {
    const config = buildEffectiveConfig([]);
    expect(config.checks).toEqual(["deps", "package", "static", "cli-adversarial", "fuzz"]);
    expect(config.profile).toBe("node-cli-package");
  });

  it("explicit --checks overrides profile defaults even when --profile is also given", () => {
    const config = buildEffectiveConfig(["--profile", "local-tool", "--checks", "secrets"]);
    expect(config.checks).toEqual(["secrets"]);
  });

  it("--profile node-cli-package with no --checks uses that profile's default checks", () => {
    const config = buildEffectiveConfig(["--profile", "node-cli-package"]);
    const expected = resolveAttackProfile("node-cli-package").defaultCheckIds;
    expect(new Set(config.checks)).toEqual(new Set(expected));
    expect(config.checks).toContain("deps");
    expect(config.checks).toContain("package");
  });

  it("--profile local-tool with no --checks uses local-tool's default checks (excludes package)", () => {
    const config = buildEffectiveConfig(["--profile", "local-tool"]);
    const expected = resolveAttackProfile("local-tool").defaultCheckIds;
    expect(new Set(config.checks)).toEqual(new Set(expected));
    expect(config.checks).not.toContain("package");
  });

  it("--profile npm-package with no --checks uses npm-package's default checks", () => {
    const config = buildEffectiveConfig(["--profile", "npm-package"]);
    const expected = resolveAttackProfile("npm-package").defaultCheckIds;
    expect(new Set(config.checks)).toEqual(new Set(expected));
  });
});

const cleanupDirs: string[] = [];
afterEach(async () => {
  await Promise.all(cleanupDirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

describe("security:validate verdict/fail-on integration against a controlled fixture", () => {
  async function runDepsPackageValidation() {
    const reportDir = mkdtempSync(path.join(os.tmpdir(), "verdict-deps-package-report-"));
    cleanupDirs.push(reportDir);
    return runSecurityValidation({
      cwd: toolRoot,
      selectedChecks: ["deps", "package"],
      profile: "node-cli-package",
      config: {
        reportDir,
        rawOutputDir: path.join(reportDir, "raw"),
      },
    });
  }

  it("a fixture with a real secret exits nonzero (verdict not-ready) regardless of --fail-on", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "verdict-secret-"));
    cleanupDirs.push(root);
    mkdirSync(path.join(root, "src"), { recursive: true });
    writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "fixture", version: "1.0.0" }), "utf8");
    writeFileSync(
      path.join(root, "src", "config.ts"),
      'export const token = "ghp_abcdefghijklmnopqrstuvwxyz0123456789";\n',
      "utf8"
    );

    const summary = await runSecurityValidation({
      cwd: toolRoot,
      targetPath: root,
      selectedChecks: ["secrets"],
      profile: "node-cli-package",
    });

    expect(summary.verdict).toBe("not-ready-security-blocker-remains");
    expect(findingsBreachFailOnThreshold(summary.findings, "blocker")).toBe(true);
    expect(findingsBreachFailOnThreshold(summary.findings, "high")).toBe(true);
  }, 30_000);

  it("a scoped low-only-finding run behaves according to --fail-on threshold", async () => {
    // self-target deps check reliably produces informational npm-outdated
    // findings in this repo (already observed in manual smoke testing).
    const reportDir = mkdtempSync(path.join(os.tmpdir(), "verdict-deps-report-"));
    cleanupDirs.push(reportDir);
    const summary = await runSecurityValidation({
      cwd: toolRoot,
      selectedChecks: ["deps"],
      profile: "node-cli-package",
      config: {
        reportDir,
        rawOutputDir: path.join(reportDir, "raw"),
      },
    });
    const hasInformational = summary.findings.some((f) => f.severity === "informational");
    if (!hasInformational) {
      // Environment-dependent (no outdated deps right now) — not a failure
      // of this batch's logic, just nothing to assert against.
      return;
    }
    expect(findingsBreachFailOnThreshold(summary.findings, "low")).toBe(true);
    expect(findingsBreachFailOnThreshold(summary.findings, "blocker")).toBe(false);
  }, 60_000);

  it("deps/package scoped validation reports optional-skip verdicts and is not a full release gate", async () => {
    const summary = await runDepsPackageValidation();
    // static/cli-adversarial/fuzz deselected -> optional skips; deps/package
    // (mandatory-bearing) selected and expected to pass against this repo.
    expect(["ready-for-release-preparation", "ready-except-optional-manual-checks"]).toContain(summary.verdict);
    expect(summary.verdict).not.toBe("not-ready-security-blocker-remains");
    expect(summary.isFullReleaseGate).toBe(false);
  }, 60_000);

  // The "full 5-check gate -> isFullReleaseGate true" case is exercised via
  // the no-flag default CLI smoke test (npm run security:validate, no
  // flags) rather than re-run here — it requires the expensive
  // cli-adversarial subprocess (spawns the whole test:security suite) and
  // is already covered end-to-end in this batch's validation.
});
