import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const verifierSource = readFileSync(path.resolve("scripts/verify-packed-package.mjs"), "utf8");
const packageJson = JSON.parse(readFileSync(path.resolve("package.json"), "utf8")) as { files: string[] };

const GATE_START = "9c-2b. v0.8.1 retrieval-query-strategy-comparison installed-package";
const GATE_END = "9c-5. v0.8.0 installed-package retrieval-precision-recall acceptance";
const gateSource = (() => {
  const start = verifierSource.indexOf(GATE_START);
  const end = verifierSource.indexOf(GATE_END);
  expect(start, "gate start marker").toBeGreaterThan(0);
  expect(end, "gate end marker").toBeGreaterThan(start);
  return verifierSource.slice(start, end);
})();

/** Executable gate code only: comments may legitimately name the version or the real kit. */
const gateCode = gateSource
  .split("\n")
  .slice(1) // the slice starts mid-way through the banner comment line
  .filter((line) => !line.trim().startsWith("//"))
  .join("\n");

const strategyPaths = [...verifierSource.matchAll(/"(dist\/src\/[^"]+)\.js"/g)]
  .map((match) => match[1])
  .filter((entry) => /retrievalQueryStrateg|runSemanticRetrievalStrategy|RetrievalQueryStrategyComparison/.test(entry));

describe("packed-package acceptance for retrieval-query-strategy-comparison", () => {
  it("names every compiled runtime owner of the plugin, strategies, analysis, external-local lifecycle and reports", () => {
    for (const required of [
      "dist/src/evaluation/retrievalQueryStrategies",
      "dist/src/evaluation/retrievalQueryStrategyEvidence",
      "dist/src/evaluation/runSemanticRetrievalStrategy",
      "dist/src/experiments/plugins/retrievalQueryStrategyComparison/index",
      "dist/src/experiments/plugins/retrievalQueryStrategyComparison/metadata",
      "dist/src/experiments/plugins/retrievalQueryStrategyComparison/config",
      "dist/src/experiments/plugins/retrievalQueryStrategyComparison/types",
      "dist/src/experiments/plugins/retrievalQueryStrategyComparison/execution",
      "dist/src/experiments/plugins/retrievalQueryStrategyComparison/executionArtifact",
      "dist/src/experiments/plugins/retrievalQueryStrategyComparison/analysisTypes",
      "dist/src/experiments/plugins/retrievalQueryStrategyComparison/analysis",
      "dist/src/experiments/plugins/retrievalQueryStrategyComparison/analysisArtifact",
      "dist/src/experiments/plugins/retrievalQueryStrategyComparison/metrics",
      "dist/src/experiments/plugins/retrievalQueryStrategyComparison/localSubjectExecution",
      "dist/src/experiments/plugins/retrievalQueryStrategyComparison/localSubjectPrivacy",
      "dist/src/experiments/plugins/retrievalQueryStrategyComparison/plugin",
      "dist/src/report/experiments/retrievalQueryStrategyComparisonReportModel",
      "dist/src/report/experiments/buildRetrievalQueryStrategyComparisonReport",
      "dist/src/report/experiments/renderRetrievalQueryStrategyComparisonHtml",
      "dist/src/report/experiments/renderRetrievalQueryStrategyComparisonText"
    ]) {
      expect(strategyPaths, required).toContain(required);
    }
  });

  it("only lists compiled paths whose TypeScript source exists, so a rename cannot silently weaken the gate", () => {
    expect(strategyPaths.length).toBeGreaterThanOrEqual(20);
    for (const compiled of strategyPaths) {
      const source = compiled.replace(/^dist\//, "") + ".ts";
      expect(existsSync(path.resolve(source)), source).toBe(true);
    }
  });

  it("keeps the bundled resources the installed run depends on packaged and named by the verifier", () => {
    expect(packageJson.files).toEqual(expect.arrayContaining(["dist/src/", "benchmarks/"]));
    for (const resource of ["benchmarks/contracts/warm-index-benchmark-cases.json", "benchmarks/contracts/benchmark-project-profiles.json"]) {
      expect(existsSync(path.resolve(resource)), resource).toBe(true);
      expect(verifierSource).toContain(`"${resource}"`);
    }
  });

  it("requires the plugin in the installed experiment list, appended after the earlier ids", () => {
    const required = /const REQUIRED_EXPERIMENT_IDS = \[([^\]]*)\]/.exec(verifierSource)?.[1] ?? "";
    const ids = required.split(",").map((entry) => entry.trim().replace(/"/g, ""));
    expect(ids).toEqual([
      "context-strategy-comparison",
      "warm-index-reuse",
      "incremental-change-staleness",
      "context-window-scaling",
      "retrieval-precision-recall",
      "retrieval-query-strategy-comparison"
    ]);
  });

  it("emits and finally requires every installed gate PASS label", () => {
    for (const gate of [
      "DISCOVERY",
      "BUNDLED",
      "REPORT",
      "EXTERNAL_REJECTIONS",
      "EXTERNAL_FAILURE",
      "EXTERNAL",
      "PRIVACY",
      "IMMUTABILITY",
      "REAL_MY_DEV_KIT"
    ]) {
      const label = `RETRIEVAL_QUERY_STRATEGY_COMPARISON_${gate}: PASS`;
      expect(gateSource, `emitted ${label}`).toContain(label);
      expect(verifierSource.split(label).length - 1, `required ${label}`).toBeGreaterThanOrEqual(2);
    }
  });

  it("proves the successful external-local run with the real published upstream my-dev-kit, never the fake", () => {
    const realStart = gateSource.indexOf("--- REAL published my-dev-kit");
    expect(realStart).toBeGreaterThan(0);
    const realSection = gateSource.slice(realStart);
    expect(realSection).toContain("realKitCommand");
    expect(realSection).toContain("UPSTREAM_MY_DEV_KIT_SPEC");
    expect(realSection).not.toContain("rqsKitCommand");
    expect(realSection).toContain("RETRIEVAL_QUERY_STRATEGY_COMPARISON_REAL_MY_DEV_KIT: PASS");
    expect(verifierSource).toMatch(/const realKitCommand = /);
  });

  it("keeps the deterministic failure and bundled fixture test-only and offline", () => {
    expect(gateSource).toContain("fake-upstream-shaped-kit-cli.js");
    expect(existsSync(path.resolve("tests/fixtures/fake-upstream-shaped-kit-cli.js"))).toBe(true);
    expect(packageJson.files.some((entry) => entry.startsWith("tests"))).toBe(false);
    // The fake is used only for the bundled run, the rejection matrix, the failure injection and observable index behavior.
    const beforeReal = gateCode.slice(0, gateCode.indexOf("if (!realKitCommand.includes(upstreamBin))"));
    expect(beforeReal).not.toMatch(/realKitCommand|UPSTREAM_MY_DEV_KIT|npx /);
    const fixture = readFileSync(path.resolve("tests/fixtures/fake-upstream-shaped-kit-cli.js"), "utf8");
    expect(fixture).toContain('command === "data-model"');
    expect(fixture).toContain("RPR_KIT_DATA_MODEL_ENTITY");
  });

  it("asserts no retrieval-quality threshold, composite score, or ranking and no hard-coded package version", () => {
    expect(gateCode).not.toMatch(/0\.8\.0|0\.8\.1/);
    expect(gateSource).toContain("rqsForbiddenPropertyNames");
    expect(gateSource).toContain('"compositeScore"');
    expect(gateSource).toContain("comparisonCaseCount !== 1");
    expect(gateCode).not.toMatch(/fileF1\??\.value\s*[<>]/);
  });
});
