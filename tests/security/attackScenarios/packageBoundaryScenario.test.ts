import { mkdtempSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { PACKAGE_BOUNDARY_SCENARIO } from "../../../src/securityValidation/attackScenarios/scenarios/packageBoundaryScenario.js";
import { DEFAULT_SECURITY_CONFIG } from "../../../src/securityValidation/config.js";
import type { SecurityValidationTarget } from "../../../src/securityValidation/validate/resolveTarget.js";
import type { AttackScenarioContext } from "../../../src/securityValidation/attackScenarios/attackScenario.js";

function fakeTarget(overrides: Partial<SecurityValidationTarget>): SecurityValidationTarget {
  return {
    targetRoot: process.cwd(),
    toolRoot: process.cwd(),
    packageName: "fake",
    packageVersion: "1.0.0",
    hasPackageJson: true,
    hasSecurityTestScript: false,
    hasLockfile: false,
    branch: "main",
    commit: "abc",
    hasGit: true,
    isSelf: false,
    ...overrides,
  };
}

function makeCtx(target: SecurityValidationTarget): AttackScenarioContext {
  return {
    toolRoot: target.targetRoot,
    target,
    profile: "node-cli-package",
    config: DEFAULT_SECURITY_CONFIG,
  };
}

const cleanupDirs: string[] = [];
afterEach(async () => {
  await Promise.all(cleanupDirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

describe("PACKAGE_BOUNDARY_SCENARIO", () => {
  it("skips cleanly when the target has no package.json", () => {
    const target = fakeTarget({ hasPackageJson: false });
    const ctx = makeCtx(target);
    const reason = PACKAGE_BOUNDARY_SCENARIO.skipCondition?.(ctx);
    expect(reason).toMatch(/no package\.json/i);
  });

  it("a safe package (this project itself) produces no blocker/failed result", async () => {
    const target = fakeTarget({ targetRoot: process.cwd(), toolRoot: process.cwd(), isSelf: true });
    const outcome = await PACKAGE_BOUNDARY_SCENARIO.run(makeCtx(target));
    expect(["passed", "blocked"]).toContain(outcome.status);
    expect(outcome.evidence.some((e) => e.commandSummary?.includes("npm pack"))).toBe(true);
  }, 30_000);

  it("forbidden .env inclusion produces a failed result with package-content evidence", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "pkg-boundary-env-"));
    cleanupDirs.push(root);
    writeFileSync(
      path.join(root, "package.json"),
      JSON.stringify({ name: "fixture-pkg", version: "1.0.0" }, null, 2),
      "utf8"
    );
    writeFileSync(path.join(root, "index.js"), "module.exports = {};\n", "utf8");
    writeFileSync(path.join(root, ".env"), "SECRET=abc123\n", "utf8");

    const target = fakeTarget({ targetRoot: root, toolRoot: root, isSelf: true });
    const outcome = await PACKAGE_BOUNDARY_SCENARIO.run(makeCtx(target));

    expect(outcome.status).toBe("failed");
    expect(outcome.evidence.some((e) => e.kind === "package-content" && e.filePath?.includes(".env"))).toBe(true);
  }, 30_000);

  it("forbidden reports/security inclusion produces a failed result", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "pkg-boundary-reports-"));
    cleanupDirs.push(root);
    writeFileSync(
      path.join(root, "package.json"),
      JSON.stringify({ name: "fixture-pkg-2", version: "1.0.0" }, null, 2),
      "utf8"
    );
    writeFileSync(path.join(root, "index.js"), "module.exports = {};\n", "utf8");
    const fs = await import("node:fs");
    fs.mkdirSync(path.join(root, "reports", "security"), { recursive: true });
    fs.writeFileSync(path.join(root, "reports", "security", "v1-security-validation.json"), "{}\n", "utf8");

    const target = fakeTarget({ targetRoot: root, toolRoot: root, isSelf: true });
    const outcome = await PACKAGE_BOUNDARY_SCENARIO.run(makeCtx(target));

    expect(outcome.status).toBe("failed");
    expect(outcome.evidence.some((e) => e.filePath?.includes("reports/security"))).toBe(true);
  }, 30_000);

  it("forbidden lab-output inclusion produces a failed result", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "pkg-boundary-lab-output-"));
    cleanupDirs.push(root);
    writeFileSync(
      path.join(root, "package.json"),
      JSON.stringify({ name: "fixture-pkg-3", version: "1.0.0" }, null, 2),
      "utf8"
    );
    writeFileSync(path.join(root, "index.js"), "module.exports = {};\n", "utf8");
    const fs = await import("node:fs");
    fs.mkdirSync(path.join(root, "lab-output"), { recursive: true });
    fs.writeFileSync(path.join(root, "lab-output", "run.json"), "{}\n", "utf8");

    const target = fakeTarget({ targetRoot: root, toolRoot: root, isSelf: true });
    const outcome = await PACKAGE_BOUNDARY_SCENARIO.run(makeCtx(target));

    expect(outcome.status).toBe("failed");
    expect(outcome.evidence.some((e) => e.filePath?.includes("lab-output"))).toBe(true);
  }, 30_000);
});
