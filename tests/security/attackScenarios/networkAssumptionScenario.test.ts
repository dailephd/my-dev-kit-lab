import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { NETWORK_ASSUMPTION_SCENARIO } from "../../../src/securityValidation/attackScenarios/scenarios/networkAssumptionScenario.js";
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

describe("NETWORK_ASSUMPTION_SCENARIO", () => {
  it("obvious fetch usage in bounded source produces evidence and fails", async () => {
    const root = makeFixtureDir("net-fetch-");
    writeFileSync(path.join(root, "src", "client.ts"), 'export async function go() { return fetch("http://example.invalid"); }\n', "utf8");
    const outcome = await NETWORK_ASSUMPTION_SCENARIO.run(makeCtx(root));
    expect(outcome.status).toBe("failed");
    expect(outcome.evidence.some((e) => e.observedBehavior?.includes("fetch-call"))).toBe(true);
  });

  it("obvious axios import in bounded source produces evidence and fails", async () => {
    const root = makeFixtureDir("net-axios-");
    writeFileSync(path.join(root, "src", "client.ts"), 'import axios from "axios";\nexport { axios };\n', "utf8");
    const outcome = await NETWORK_ASSUMPTION_SCENARIO.run(makeCtx(root));
    expect(outcome.status).toBe("failed");
  });

  it("known dependency-validation paths (npm audit style) are labeled network-using, not unexpected violations", async () => {
    const root = makeFixtureDir("net-known-intentional-");
    const depsDir = path.join(root, "src", "securityValidation", "dependencies");
    mkdirSync(depsDir, { recursive: true });
    writeFileSync(path.join(depsDir, "runDependencyChecks.ts"), 'import fetch from "node-fetch";\nexport { fetch };\n', "utf8");
    const outcome = await NETWORK_ASSUMPTION_SCENARIO.run(makeCtx(root));
    // Known-intentional path match must not fail the scenario.
    expect(outcome.status).toBe("passed");
    expect(
      outcome.evidence.some((e) => e.source?.includes("known network-using validation commands"))
    ).toBe(true);
  });

  it("source with no obvious network APIs passes only the bounded static-check claim", async () => {
    const root = makeFixtureDir("net-clean-");
    writeFileSync(path.join(root, "src", "math.ts"), "export function add(a: number, b: number) { return a + b; }\n", "utf8");
    const outcome = await NETWORK_ASSUMPTION_SCENARIO.run(makeCtx(root));
    expect(outcome.status).toBe("passed");
  });

  it("missing/unscannable source skips cleanly (passes with bounded-scan wording, does not crash)", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "net-empty-"));
    cleanupDirs.push(root);
    const outcome = await NETWORK_ASSUMPTION_SCENARIO.run(makeCtx(root));
    expect(outcome.status).toBe("passed");
    expect(outcome.evidence.some((e) => e.observedBehavior?.includes("nothing to scan"))).toBe(true);
  });

  it("report wording never claims full runtime network isolation", async () => {
    const root = makeFixtureDir("net-wording-");
    writeFileSync(path.join(root, "src", "math.ts"), "export function add(a: number, b: number) { return a + b; }\n", "utf8");
    const outcome = await NETWORK_ASSUMPTION_SCENARIO.run(makeCtx(root));
    const caveat = outcome.evidence.find((e) => e.source === "scope statement");
    expect(caveat?.expectedBehavior).toMatch(/does not prove runtime network isolation/i);
  });

  it("scenario performs no network calls itself (fixture with only local files, deterministic result)", async () => {
    const root = makeFixtureDir("net-no-calls-");
    writeFileSync(path.join(root, "src", "math.ts"), "export function add(a: number, b: number) { return a + b; }\n", "utf8");
    const first = await NETWORK_ASSUMPTION_SCENARIO.run(makeCtx(root));
    const second = await NETWORK_ASSUMPTION_SCENARIO.run(makeCtx(root));
    expect(first.status).toBe(second.status);
  });
});
