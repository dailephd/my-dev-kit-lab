import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const verifierSource = readFileSync(path.resolve("scripts/verify-packed-package.mjs"), "utf8");
const packageJson = JSON.parse(readFileSync(path.resolve("package.json"), "utf8")) as { files: string[]; version: string };

const retrievalPaths = [...verifierSource.matchAll(/"(dist\/src\/[^"]+)\.js"/g)]
  .map((match) => match[1])
  .filter((entry) => /retrievalQuality|retrievalPrecisionRecall|RetrievalPrecisionRecall|runMyDevKitRetrieval|warmIndexReuse\/selection/.test(entry));

describe("packed-package acceptance for retrieval-precision-recall", () => {
  it("TST-B4-047 requires the compiled runtime owners of the plugin, its evidence, metrics, external-local lifecycle and reports", () => {
    for (const required of [
      "dist/src/evaluation/retrievalQuality/buildRetrievalEvidence",
      "dist/src/evaluation/retrievalQuality/metrics",
      "dist/src/evaluation/retrievalQuality/factContextTargets",
      "dist/src/evaluation/retrievalQuality/corpusCompleteness",
      "dist/src/experiments/plugins/retrievalPrecisionRecall/config",
      "dist/src/experiments/plugins/retrievalPrecisionRecall/metadata",
      "dist/src/experiments/plugins/retrievalPrecisionRecall/execution",
      "dist/src/experiments/plugins/retrievalPrecisionRecall/executionArtifact",
      "dist/src/experiments/plugins/retrievalPrecisionRecall/metrics",
      "dist/src/experiments/plugins/retrievalPrecisionRecall/plugin",
      "dist/src/experiments/plugins/retrievalPrecisionRecall/types",
      "dist/src/experiments/plugins/retrievalPrecisionRecall/localSubjectExecution",
      "dist/src/experiments/plugins/retrievalPrecisionRecall/localSubjectPrivacy",
      "dist/src/report/experiments/buildRetrievalPrecisionRecallReport",
      "dist/src/report/experiments/retrievalPrecisionRecallReportModel",
      "dist/src/report/experiments/renderRetrievalPrecisionRecallHtml",
      "dist/src/report/experiments/renderRetrievalPrecisionRecallText"
    ]) {
      expect(retrievalPaths, required).toContain(required);
    }
  });

  it("only lists compiled paths whose TypeScript source exists, so a rename cannot silently weaken the gate", () => {
    expect(retrievalPaths.length).toBeGreaterThanOrEqual(22);
    for (const compiled of retrievalPaths) {
      const source = compiled.replace(/^dist\//, "") + ".ts";
      expect(existsSync(path.resolve(source)), source).toBe(true);
    }
  });

  it("keeps the bundled resources the installed run depends on in the published allowlist and the verifier path list", () => {
    expect(packageJson.files).toEqual(expect.arrayContaining(["dist/src/", "benchmarks/"]));
    for (const resource of ["benchmarks/contracts/warm-index-benchmark-cases.json", "benchmarks/contracts/benchmark-project-profiles.json"]) {
      expect(existsSync(path.resolve(resource)), resource).toBe(true);
      expect(verifierSource).toContain(`"${resource}"`);
    }
    expect(packageJson.version).toBe("0.7.2");
  });

  it("requires retrieval-precision-recall in the installed experiment list", () => {
    const required = /const REQUIRED_EXPERIMENT_IDS = \[([^\]]*)\]/.exec(verifierSource)?.[1] ?? "";
    expect(required).toContain('"retrieval-precision-recall"');
  });

  it("declares the installed discovery, bundled, external-local success, failure, privacy and immutability gates with an offline fixture", () => {
    for (const gate of [
      "RETRIEVAL_PRECISION_RECALL_DISCOVERY",
      "RETRIEVAL_PRECISION_RECALL_BUNDLED",
      "RETRIEVAL_PRECISION_RECALL_EXTERNAL_REJECTIONS",
      "RETRIEVAL_PRECISION_RECALL_EXTERNAL_FAILURE",
      "RETRIEVAL_PRECISION_RECALL_EXTERNAL",
      "RETRIEVAL_PRECISION_RECALL_PRIVACY",
      "RETRIEVAL_PRECISION_RECALL_IMMUTABILITY"
    ]) {
      expect(verifierSource, gate).toContain(`${gate}: PASS`);
    }
    expect(verifierSource).toContain("fake-upstream-shaped-kit-cli.js");
    expect(existsSync(path.resolve("tests/fixtures/fake-upstream-shaped-kit-cli.js"))).toBe(true);
    // The gate must not depend on the network or the published upstream package for this plugin.
    const gateStart = verifierSource.indexOf("9c-5. v0.8.0 installed-package retrieval-precision-recall acceptance");
    const gateEnd = verifierSource.indexOf("9c-3. v0.6.2 incremental-change-staleness installed-package acceptance");
    expect(gateStart).toBeGreaterThan(0);
    expect(gateEnd).toBeGreaterThan(gateStart);
    expect(verifierSource.slice(gateStart, gateEnd)).not.toMatch(/realKitCommand|UPSTREAM_MY_DEV_KIT|npx /);
  });
});
