import { mkdtempSync } from "node:fs";
import { readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createDefaultExperimentPluginRegistry,
  retrievalPrecisionRecallPlugin,
  runExperiment,
  validateRetrievalPrecisionRecallConfig,
  RETRIEVAL_PRECISION_RECALL_EXECUTION_SCHEMA_VERSION,
  type RetrievalPrecisionRecallDependencies,
  type RetrievalPrecisionRecallRun
} from "../../../src/experiments/index.js";
import { writePluginExperimentReports } from "../../../src/report/index.js";
import {
  COMMAND_PATH_SENTINEL,
  evidenceOf,
  indexResultOf,
  makeEvaluationCase,
  retrievalResultOf,
  SOURCE_SENTINEL,
  STDERR_SENTINEL,
  STDOUT_SENTINEL
} from "./retrievalPrecisionRecallTestHelpers.js";

const tempDirs: string[] = [];
afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});
const tempDir = () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "rpr-plugin-"));
  tempDirs.push(dir);
  return dir;
};

const cases = [
  makeEvaluationCase({ id: "m1", project: "project-a" }),
  makeEvaluationCase({ id: "m2", project: "project-a" }),
  makeEvaluationCase({ id: "l1", project: "project-b" }),
  makeEvaluationCase({ id: "l2", project: "project-b" })
];

function dependencies(seen: string[] = []): RetrievalPrecisionRecallDependencies {
  return {
    async buildIndex(args) {
      return indexResultOf(args.indexDir);
    },
    async retrieveFromIndex(args) {
      seen.push(args.evaluationCase.id);
      return retrievalResultOf(args.evaluationCase, evidenceOf(["src/a.ts", "src/extra.ts"], [{ name: "A", file: "src/a.ts" }]));
    }
  };
}

async function run(options: { config?: unknown; targetPath?: string; seen?: string[]; outputRoot?: string } = {}): Promise<RetrievalPrecisionRecallRun> {
  const outputRoot = options.outputRoot ?? tempDir();
  return (await runExperiment({
    pluginId: "retrieval-precision-recall",
    outputRoot,
    toolRoot: process.cwd(),
    targetPath: options.targetPath,
    config: options.config,
    inputs: { cases, retrievalDependencies: dependencies(options.seen) }
  })) as RetrievalPrecisionRecallRun;
}

describe("retrieval-precision-recall plugin contract", () => {
  it("TST-B3-013 is registered exactly once", () => {
    const ids = createDefaultExperimentPluginRegistry().list().map((entry) => entry.id);
    expect(ids.filter((id) => id === "retrieval-precision-recall")).toHaveLength(1);
    expect(ids).toEqual(["context-strategy-comparison", "warm-index-reuse", "incremental-change-staleness", "context-window-scaling", "retrieval-precision-recall"]);
  });

  it("TST-B3-014 declares the frozen metadata without plot or screenshot outputs", () => {
    expect(retrievalPrecisionRecallPlugin.metadata).toEqual({
      id: "retrieval-precision-recall",
      name: "Retrieval Precision/Recall",
      description: "Measure deterministic file, symbol, fact and irrelevant-context retrieval quality for the existing my-dev-kit retrieval lifecycle without agents.",
      schemaVersion: "1.0.0",
      status: "experimental",
      supportedTargets: ["self", "external-local"],
      supportedOutputs: ["json", "html", "text", "artifact"]
    });
  });

  it("TST-B3-015 has exactly one scientific variant", async () => {
    expect(retrievalPrecisionRecallPlugin.supportedVariants).toEqual(["my-dev-kit-retrieval"]);
    const result = await run();
    expect(result.variants.map((variant) => variant.id)).toEqual(["my-dev-kit-retrieval"]);
    for (const experimentCase of result.cases) {
      expect(experimentCase.outcomes.map((outcome) => outcome.variantId)).toEqual(["my-dev-kit-retrieval"]);
    }
  });

  it("describes its closed config contract", () => {
    const description = createDefaultExperimentPluginRegistry().describe("retrieval-precision-recall");
    expect(description.id).toBe("retrieval-precision-recall");
    expect(retrievalPrecisionRecallPlugin.configDefinition?.fields.map((field) => field.name)).toEqual(["outDir", "kitCommand", "caseIds", "benchmarkProjects"]);
    expect(retrievalPrecisionRecallPlugin.defaultConfig).toEqual({ outDir: "lab-output/retrieval-precision-recall", kitCommand: "npx @dailephd/my-dev-kit@latest" });
  });

  it("TST-B3-016 rejects unknown config fields and invalid filters", () => {
    expect(validateRetrievalPrecisionRecallConfig({}).valid).toBe(true);
    expect(validateRetrievalPrecisionRecallConfig({ caseIds: ["a"], benchmarkProjects: ["p"], kitCommand: "k", outDir: "o" }).valid).toBe(true);
    for (const config of [
      { casesPath: "x.json" },
      { projectProfilesPath: "x.json" },
      { campaignPreset: "c" },
      { agents: ["fake-agent"] },
      { targetRoot: "x" },
      { caseIds: [] },
      { benchmarkProjects: [] },
      { caseIds: [""] },
      { caseIds: "a" },
      { kitCommand: "" },
      { outDir: 5 },
      "not-an-object"
    ]) {
      expect(validateRetrievalPrecisionRecallConfig(config).valid, JSON.stringify(config)).toBe(false);
    }
    expect(validateRetrievalPrecisionRecallConfig({ casesPath: "x", agents: [] }).errors[0]).toBe("Unsupported retrieval-precision-recall config field(s): agents, casesPath.");
  });

  it("TST-B3-017 filters the bundled corpus without reordering it and rejects unknown or empty selections", async () => {
    const seen: string[] = [];
    const filtered = await run({ config: { caseIds: ["l2", "m1"] }, seen });
    expect(filtered.cases.map((experimentCase) => experimentCase.id)).toEqual(["m1", "l2"]);
    expect(seen).toEqual(["m1", "l2"]);

    const byProject = await run({ config: { benchmarkProjects: ["project-b"] } });
    expect(byProject.cases.map((experimentCase) => experimentCase.id)).toEqual(["l1", "l2"]);

    for (const config of [{ caseIds: ["nope"] }, { benchmarkProjects: ["nope"] }, { caseIds: ["m1"], benchmarkProjects: ["project-b"] }]) {
      const failed = await run({ config });
      expect(failed.status, JSON.stringify(config)).toBe("failed");
      expect(failed.failures[0].message).toMatch(/not found|No evaluation cases matched/);
    }
  });

  it("TST-B3-023 fails closed for an external target without a loaded subject even when invoked outside the CLI (Batch 4: no bundled fallback)", async () => {
    const external = tempDir();
    const result = await run({ targetPath: external });
    expect(result.status).toBe("failed");
    expect(result.failures).toEqual([
      { code: "experiment-run-failed", message: "External-local retrieval-precision-recall targets require a loaded local repository subject (--local-subject-config).", recoverable: false }
    ]);
    expect(result.cases).toEqual([]);
  });
});

describe("retrieval-precision-recall run and artifact", () => {
  it("TST-B3-024 writes one execution artifact with cases, aggregate and estimator, and no context or raw output", async () => {
    const outputRoot = tempDir();
    const result = await run({ outputRoot });
    expect(result.status).toBe("completed");

    const artifactEntry = result.artifacts.find((artifact) => artifact.id === "retrieval-precision-recall-execution");
    expect(artifactEntry).toMatchObject({ kind: "artifact", mimeType: "application/json" });
    expect(path.basename(artifactEntry!.path!)).toBe("retrieval-precision-recall-execution.json");
    expect(result.artifacts).toHaveLength(1);

    const artifact = JSON.parse(await readFile(artifactEntry!.path!, "utf8"));
    expect(artifact).toMatchObject({
      schemaVersion: RETRIEVAL_PRECISION_RECALL_EXECUTION_SCHEMA_VERSION,
      pluginId: "retrieval-precision-recall",
      pluginSchemaVersion: "1.0.0",
      tokenCountMethod: "estimated_chars_div_4"
    });
    expect(artifact.runId).toBe(result.runId);
    expect(artifact.cases.map((entry: { caseId: string }) => entry.caseId)).toEqual(["m1", "m2", "l1", "l2"]);
    expect(artifact.aggregate.runSummary).toMatchObject({ caseCount: 4, projectCount: 2, completedCaseCount: 4 });
    expect(artifact.cases[0].quality.schemaVersion).toBe("retrieval-quality-metrics-v1");

    const serialized = JSON.stringify(artifact);
    for (const forbidden of [SOURCE_SENTINEL, STDOUT_SENTINEL, STDERR_SENTINEL, COMMAND_PATH_SENTINEL, "sentinel-user", "contextText", "stdout", "stderr", "commandString", outputRoot]) {
      expect(serialized, forbidden).not.toContain(forbidden);
    }
  });

  it("keeps source-bearing retrieval objects off the generic ExperimentRun", async () => {
    const result = await run();
    const serialized = JSON.stringify(result);
    for (const forbidden of [SOURCE_SENTINEL, STDOUT_SENTINEL, STDERR_SENTINEL, COMMAND_PATH_SENTINEL, "contextText"]) {
      expect(serialized, forbidden).not.toContain(forbidden);
    }
    expect(Object.keys(result).sort()).toEqual(
      ["aggregate", "artifacts", "caseExecutionEvidence", "cases", "completedAt", "failures", "metadata", "metrics", "pluginId", "runId", "startedAt", "status", "summary", "target", "variants", "warnings"].sort()
    );
  });

  it("TST-B3-035 leaves no sentinel source, raw output or command path in the artifact or any report file", async () => {
    const outputRoot = tempDir();
    const result = await run({ outputRoot });
    await writePluginExperimentReports({ run: result, plugin: retrievalPrecisionRecallPlugin.metadata, outputRoot });
    const files = (await readdir(outputRoot)).filter((name) => /\.(json|html|txt)$/.test(name)).sort();
    expect(files).toEqual(["report.html", "report.json", "report.txt", "retrieval-precision-recall-execution.json"]);
    for (const file of files) {
      const text = await readFile(path.join(outputRoot, file), "utf8");
      for (const forbidden of [SOURCE_SENTINEL, STDOUT_SENTINEL, STDERR_SENTINEL, COMMAND_PATH_SENTINEL, "sentinel-user"]) {
        expect(text, `${file} contains ${forbidden}`).not.toContain(forbidden);
      }
      expect(text, file).not.toMatch(/"(contextText|stdout|stderr)"\s*:/);
    }
  });

  it("projects per-case outcomes with availability metadata and statuses", async () => {
    const result = await run();
    const outcome = result.cases[0].outcomes[0];
    expect(outcome.status).toBe("completed");
    expect(outcome.metrics.map((metric) => metric.id)).toHaveLength(12);
    expect(outcome.metadata).toMatchObject({ benchmarkProject: "project-a", evidenceAvailability: "available" });
    expect((outcome.metadata!.metricAvailability as Record<string, { availability: string }>).filePrecision.availability).toBe("available");
    expect(result.metrics.find((metric) => metric.id === "case-count")?.value).toBe(4);
  });
});
