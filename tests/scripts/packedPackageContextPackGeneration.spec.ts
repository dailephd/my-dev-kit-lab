import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { renderExperimentRunHelp } from "../../src/cli/help.js";

const verifierSource = readFileSync(path.resolve("scripts/verify-packed-package.mjs"), "utf8").replace(/\r\n/g, "\n");
const packageJson = JSON.parse(readFileSync(path.resolve("package.json"), "utf8")) as { files: string[] };

const GATE_START = "9c-6. v0.8.2 context-pack-generation installed-package";
const GATE_END = "9d. v0.5.2 real-agent campaign acceptance.";
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
  .slice(1)
  .filter((line) => !line.trim().startsWith("//"))
  .join("\n");

const compiledPaths = [...verifierSource.matchAll(/"(dist\/src\/[^"]+)\.js"/g)].map((match) => match[1]);
const contextPackPaths = compiledPaths.filter((entry) => /contextPackGeneration|ContextPackGeneration|loadContextPackArtifacts/.test(entry));

describe("packed-package acceptance for context-pack-generation", () => {
  it("names every compiled runtime owner of the plugin, execution, analysis, external-local lifecycle and reports", () => {
    for (const name of [
      "analysis",
      "analysisArtifact",
      "analysisTypes",
      "buildContextPack",
      "config",
      "execution",
      "executionArtifact",
      "executionTypes",
      "identityEvidence",
      "index",
      "localSubjectExecution",
      "localSubjectPrivacy",
      "metadata",
      "metrics",
      "packArtifact",
      "packEvidence",
      "packSelectionPolicy",
      "plugin",
      "renderContextPack",
      "types"
    ]) {
      expect(contextPackPaths, name).toContain(`dist/src/experiments/plugins/contextPackGeneration/${name}`);
    }
    for (const name of ["contextPackGenerationReportModel", "buildContextPackGenerationReport", "loadContextPackArtifacts", "renderContextPackGenerationHtml", "renderContextPackGenerationText"]) {
      expect(contextPackPaths, name).toContain(`dist/src/report/experiments/${name}`);
    }
  });

  it("only lists compiled paths whose TypeScript source exists, so a rename cannot silently weaken the gate", () => {
    expect(contextPackPaths.length).toBeGreaterThanOrEqual(25);
    for (const compiled of contextPackPaths) {
      expect(existsSync(path.resolve(compiled.replace(/^dist\//, "") + ".ts")), compiled).toBe(true);
    }
  });

  it("requires every source owner module of the plugin directory to be named, so a new runtime file cannot be omitted", () => {
    const sourceFiles = ["analysis", "analysisArtifact", "analysisTypes", "buildContextPack", "config", "execution", "executionArtifact", "executionTypes", "identityEvidence", "index", "localSubjectExecution", "localSubjectPrivacy", "metadata", "metrics", "packArtifact", "packEvidence", "packSelectionPolicy", "plugin", "renderContextPack", "types"];
    for (const name of sourceFiles) expect(existsSync(path.resolve(`src/experiments/plugins/contextPackGeneration/${name}.ts`)), name).toBe(true);
  });

  it("requires the experiment id last, after every earlier id in the existing order", () => {
    const required = /const REQUIRED_EXPERIMENT_IDS = \[([^\]]*)\]/.exec(verifierSource)?.[1] ?? "";
    const ids = required.split(",").map((entry) => entry.trim().replace(/"/g, ""));
    // v0.9.0 appends agent-success-rate as the eighth required plugin; the seven historical ids and their order are unchanged.
    expect(ids.slice(0, 7)).toEqual([
      "context-strategy-comparison",
      "warm-index-reuse",
      "incremental-change-staleness",
      "context-window-scaling",
      "retrieval-precision-recall",
      "retrieval-query-strategy-comparison",
      "context-pack-generation"
    ]);
  });

  it("asserts the exact installed schemas, treatment order and scope order", () => {
    for (const schema of [
      "my-dev-kit-lab-context-pack-experiment-v1",
      "my-dev-kit-lab-context-pack-generation-execution-v1",
      "my-dev-kit-lab-context-pack-generation-analysis-v1",
      "my-dev-kit-lab-context-pack-generation-report-v1"
    ]) {
      expect(gateSource, schema).toContain(`"${schema}"`);
    }
    expect(gateSource).toContain('const CPG_TREATMENTS = ["raw-full-file", "context-pack"]');
    expect(gateSource).toContain('const CPG_SCOPES = ["overall", "localized", "cross-module", "broad-change"]');
    expect(gateSource).toContain("Context Pack Generation");
    expect(gateSource).toContain("Supported variants: raw-full-file, context-pack");
  });

  it("covers installed flag rejection for synthetic config, context budgets, campaign, strategy and treatment selection", () => {
    for (const flag of ["--synthetic-config", "--context-budgets", "--campaign-preset", "--strategy", "--treatment"]) {
      expect(gateSource, flag).toContain(`"${flag}"`);
    }
  });

  it("emits and finally requires every installed gate PASS label", () => {
    for (const label of ["DISCOVERY", "FLAGS", "BUNDLED", "REPORT", "EXTERNAL_REJECTIONS", "EXTERNAL", "PRIVACY", "IMMUTABILITY", "REAL_MY_DEV_KIT"].map((gate) => `CONTEXT_PACK_GENERATION_${gate}: PASS`)) {
      expect(gateSource, `emitted ${label}`).toContain(label);
      expect(verifierSource.split(label).length - 1, `required ${label}`).toBeGreaterThanOrEqual(2);
    }
  });

  it("scans every durable external-local file and requires the exact durable family with no pack body", () => {
    expect(gateSource).toContain("privacyScan.scanDurableOutputDirectory(cpgOut, cpgSentinels)");
    expect(gateSource).toContain("privacyScan.scanDurableOutputDirectory(cpgRealOut, cpgSentinels)");
    expect(gateSource).toContain('const CPG_EXTERNAL_FAMILY = [CPG_ANALYSIS_FILE, CPG_EXECUTION_FILE, CPG_MANIFEST_FILE, "report.html", "report.json", "report.txt"]');
    expect(gateSource).toContain("pack-artifact-unavailable");
    expect(gateSource).toContain("redacted-external-local");
    for (const sentinelClass of ["symbol:src/", "file:src/", "taskModel.test.ts", "queryPhrase", "testSource", "private index path", "private scratch path"]) {
      expect(gateSource, sentinelClass).toContain(sentinelClass);
    }
  });

  it("proves target immutability for rejections and for the deterministic and real external-local runs", () => {
    expect(gateSource).toContain("snapshotDirectory(cpgTarget)");
    expect(gateSource).toContain("expectCpgTargetUntouched");
    for (const label of ["Installed negative case", "deterministic kit", "real my-dev-kit"]) expect(gateSource, label).toContain(label);
  });

  it("proves the real published upstream my-dev-kit compatibility, never the deterministic kit", () => {
    const realStart = gateSource.indexOf("--- REAL published my-dev-kit");
    expect(realStart).toBeGreaterThan(0);
    const realSection = gateSource.slice(realStart);
    expect(realSection).toContain("realKitCommand");
    expect(realSection).toContain("UPSTREAM_MY_DEV_KIT_SPEC");
    expect(realSection).not.toContain("cpgKitCommand");
    expect(realSection).toContain("CONTEXT_PACK_GENERATION_REAL_MY_DEV_KIT: PASS");
    expect(verifierSource).toMatch(/const realKitCommand = /);
  });

  it("keeps the deterministic kit test-only, offline and unpackaged", () => {
    expect(gateSource).toContain("fakeContextPackKit.mjs");
    expect(existsSync(path.resolve("tests/experiments/contextPackGeneration/fakeContextPackKit.mjs"))).toBe(true);
    expect(packageJson.files.some((entry) => entry.startsWith("tests"))).toBe(false);
    const beforeReal = gateCode.slice(0, gateCode.indexOf("if (!realKitCommand.includes(upstreamBin))"));
    expect(beforeReal).not.toMatch(/realKitCommand|UPSTREAM_MY_DEV_KIT|npx /);
    // The earlier v0.6.1 section guard forbids these spellings anywhere between its markers, which include this gate.
    expect(gateSource).not.toMatch(/@latest|fakeKitCommand|fake-my-dev-kit|FAKE_MY_DEV_KIT/);
  });

  it("asserts no retrieval-quality threshold, ranking or winner, and no hard-coded package version", () => {
    expect(gateCode).not.toMatch(/0\.8\.2|0\.8\.1|0\.8\.0/);
    expect(gateCode).not.toMatch(/fileF1\??\.value\s*[<>]|factCoverage\??\.value\s*[<>]/);
    expect(gateSource).toContain("winner|^rank$|ranking|bestTreatment|composite|pareto|^score$");
    expect(gateSource).toContain("matched-complete-case-macro-mean");
  });

  it("keeps the bundled benchmark resources the installed run depends on packaged", () => {
    expect(packageJson.files).toEqual(expect.arrayContaining(["dist/src/", "benchmarks/"]));
    expect(existsSync(path.resolve("benchmarks/contracts/warm-index-benchmark-cases.json"))).toBe(true);
    expect(verifierSource).toContain('"benchmarks/contracts/warm-index-benchmark-cases.json"');
  });

  it("keeps the agent-instruction adapters out of the npm artifact", () => {
    for (const forbidden of ["AGENTS.md", "agents.txt", "CLAUDE.md", "claude.txt", ".claude"]) {
      expect(packageJson.files, forbidden).not.toContain(forbidden);
    }
  });

  it("matches the --kit-command help heading the installed verifier asserts, and names context-pack-generation", () => {
    const heading = "my-dev-kit command override (warm-index-reuse, incremental-change-staleness, context-window-scaling, retrieval-precision-recall, retrieval-query-strategy-comparison, and context-pack-generation):";
    expect(renderExperimentRunHelp()).toContain(heading);
    expect(verifierSource).toContain(heading);
  });
});
