import { access, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { resolveWithinRoot } from "../../../core/pathSafety.js";
import type { EvaluationCase } from "../../../evaluation/types.js";
import { summarizeExperimentRun } from "../../results.js";
import type { ExperimentCase, ExperimentOutcome, ExperimentPlugin, ExperimentRun, ExperimentRunStatus } from "../../types.js";
import { selectWarmIndexCases } from "../warmIndexReuse/selection.js";
import { analyzeContextPackGeneration } from "./analysis.js";
import { buildContextPackGenerationAnalysisArtifact, CONTEXT_PACK_GENERATION_ANALYSIS_ARTIFACT_FILE } from "./analysisArtifact.js";
import type { ContextPackGenerationAnalysisV1, ContextPackGenerationTreatmentAnalysisV1 } from "./analysisTypes.js";
import {
  contextPackGenerationConfigDefinition,
  defaultContextPackGenerationConfig,
  validateContextPackGenerationConfig,
  type ContextPackGenerationConfig
} from "./config.js";
import { executeContextPackGeneration, type ContextPackGenerationDependencies } from "./execution.js";
import { buildContextPackGenerationExecutionArtifact, CONTEXT_PACK_GENERATION_EXECUTION_ARTIFACT_FILE } from "./executionArtifact.js";
import type { ContextPackGenerationCaseEvidenceV1, ContextPackGenerationCaseResult, ContextPackGenerationTreatmentEvidenceV1 } from "./executionTypes.js";
import { CONTEXT_PACK_GENERATION_PLUGIN_ID, CONTEXT_PACK_GENERATION_VARIANTS, contextPackGenerationMetadata } from "./metadata.js";
import { toContextPackGenerationCaseComparisonMetrics, toContextPackGenerationOutcomeMetrics, toContextPackGenerationRunMetrics } from "./metrics.js";
import { contextPackArtifactRelativePath, serializeContextPackArtifact } from "./packArtifact.js";

/** Batch 2 supports bundled/self execution only. */
export const CONTEXT_PACK_GENERATION_SELF_ONLY_MESSAGE = "context-pack-generation currently supports only the bundled self target.";
export const CONTEXT_PACK_GENERATION_PERSISTENCE_FAILURE_MESSAGE = "Context pack generation artifact persistence failed.";
export const CONTEXT_PACK_GENERATION_ARTIFACT_STATE_MESSAGE = "Context pack generation artifact state was inconsistent; nothing was written.";

/** Filesystem seam so tests can prove write order and failure behavior. Production uses the real filesystem. */
export type ContextPackGenerationArtifactIo = {
  ensureDirectory(directory: string): Promise<void>;
  exists(filePath: string): Promise<boolean>;
  writeFile(filePath: string, content: string): Promise<void>;
  removeFile(filePath: string): Promise<void>;
};

const defaultArtifactIo: ContextPackGenerationArtifactIo = {
  ensureDirectory: async (directory) => {
    await mkdir(directory, { recursive: true });
  },
  exists: async (filePath) => {
    try {
      await access(filePath);
      return true;
    } catch {
      return false;
    }
  },
  writeFile: (filePath, content) => writeFile(filePath, content, "utf8"),
  removeFile: (filePath) => rm(filePath, { force: true })
};

/** Carries only bounded, source-free evidence; pack bodies never attach to the run. */
export type ContextPackGenerationRun = ExperimentRun & {
  caseExecutionEvidence: ContextPackGenerationCaseEvidenceV1[];
  analysis: ContextPackGenerationAnalysisV1;
};

export const contextPackGenerationPlugin: ExperimentPlugin<ContextPackGenerationConfig, ContextPackGenerationRun> = {
  metadata: contextPackGenerationMetadata,
  defaultConfig: defaultContextPackGenerationConfig,
  configDefinition: contextPackGenerationConfigDefinition,
  supportedVariants: CONTEXT_PACK_GENERATION_VARIANTS.map((variant) => variant.id),
  validateConfig: validateContextPackGenerationConfig,
  async run(context) {
    const startedAt = context.startedAt.toISOString();
    const inputs = context.inputs;
    // The runner does not enforce supportedTargets; never run the bundled corpus against another target.
    if (inputs?.localSubject || context.target.kind !== "self" || context.target.isSelf !== true) {
      throw new Error(CONTEXT_PACK_GENERATION_SELF_ONLY_MESSAGE);
    }
    const cases = selectWarmIndexCases(readCasesInput(inputs), context.config);
    const outDir = context.outputRoot ?? path.resolve(context.toolRoot, context.config.outDir);
    const io = readArtifactIo(inputs);
    await io.ensureDirectory(outDir);

    // 1-3. Execute every case and construct all packs in memory; nothing durable is written yet.
    const results = await executeContextPackGeneration({
      cases,
      kitCommand: context.config.kitCommand,
      outputRoot: outDir,
      dependencies: readDependenciesInput(inputs)
    });
    const caseEvidence = results.map((result) => result.evidence);
    // Scientific analysis is calculated in memory before persistence; reports later consume it, never recalculate it.
    const analysis = analyzeContextPackGeneration(cases, caseEvidence);
    const completedAt = new Date().toISOString();

    // 4-6. Build and validate the complete artifact state.
    const common = { runId: context.runId, pluginId: contextPackGenerationMetadata.id, pluginSchemaVersion: contextPackGenerationMetadata.schemaVersion, startedAt, completedAt };
    const executionArtifact = buildContextPackGenerationExecutionArtifact({ ...common, cases: caseEvidence });
    const analysisArtifact = buildContextPackGenerationAnalysisArtifact({ ...common, analysis });
    const packFiles = collectPackFiles(results, outDir);

    // 7-9. Packs in corpus order, then the execution artifact, then the analysis artifact last.
    const executionArtifactPath = resolveWithinRoot(outDir, CONTEXT_PACK_GENERATION_EXECUTION_ARTIFACT_FILE);
    const analysisArtifactPath = resolveWithinRoot(outDir, CONTEXT_PACK_GENERATION_ANALYSIS_ARTIFACT_FILE);
    const created: string[] = [];
    const write = async (filePath: string, content: string): Promise<void> => {
      const existed = await io.exists(filePath);
      await io.writeFile(filePath, content);
      if (!existed) created.push(filePath);
    };
    try {
      if (packFiles.length > 0) await io.ensureDirectory(resolveWithinRoot(outDir, "packs"));
      for (const packFile of packFiles) await write(packFile.absolutePath, packFile.content);
      await write(executionArtifactPath, `${JSON.stringify(executionArtifact, null, 2)}\n`);
      await write(analysisArtifactPath, `${JSON.stringify(analysisArtifact, null, 2)}\n`);
    } catch {
      // Remove only files this attempt created; never touch anything else.
      for (const filePath of created.reverse()) {
        try {
          await io.removeFile(filePath);
        } catch {
          // best effort: the failure below is the outcome
        }
      }
      throw new Error(CONTEXT_PACK_GENERATION_PERSISTENCE_FAILURE_MESSAGE);
    }

    return mapContextPackGenerationToRun({
      runId: context.runId,
      startedAt,
      completedAt,
      target: context.target,
      caseEvidence,
      analysis,
      executionArtifactPath,
      analysisArtifactPath,
      packArtifactPaths: packFiles.map((packFile) => ({ caseId: packFile.caseId, path: packFile.relativePath }))
    });
  },
  summarize(result) {
    return result.summary ?? summarizeExperimentRun(result);
  }
};

type PackFile = { caseId: string; relativePath: string; absolutePath: string; content: string };

/** Validates that every produced pack has exactly the path its evidence promises, then serializes in corpus order. */
function collectPackFiles(results: readonly ContextPackGenerationCaseResult[], outDir: string): PackFile[] {
  const files: PackFile[] = [];
  const seen = new Set<string>();
  for (const result of results) {
    const packTreatment = result.evidence.treatments.find((treatment) => treatment.treatmentId === "context-pack");
    if (!result.pack) {
      if (packTreatment?.packArtifactPath) throw new Error(CONTEXT_PACK_GENERATION_ARTIFACT_STATE_MESSAGE);
      continue;
    }
    const relativePath = contextPackArtifactRelativePath(result.evidence.caseId);
    if (packTreatment?.packArtifactPath !== relativePath || seen.has(relativePath) || result.pack.caseId !== result.evidence.caseId) {
      throw new Error(CONTEXT_PACK_GENERATION_ARTIFACT_STATE_MESSAGE);
    }
    seen.add(relativePath);
    files.push({ caseId: result.evidence.caseId, relativePath, absolutePath: resolveWithinRoot(outDir, relativePath), content: serializeContextPackArtifact(result.pack) });
  }
  return files;
}

export function mapContextPackGenerationToRun(args: {
  runId: string;
  startedAt: string;
  completedAt: string;
  target: ExperimentRun["target"];
  caseEvidence: readonly ContextPackGenerationCaseEvidenceV1[];
  analysis: ContextPackGenerationAnalysisV1;
  executionArtifactPath: string;
  analysisArtifactPath: string;
  packArtifactPaths: readonly { caseId: string; path: string }[];
}): ContextPackGenerationRun {
  const cases: ExperimentCase[] = args.caseEvidence.map((entry, caseIndex) => ({
    id: entry.caseId,
    name: entry.caseName,
    outcomes: entry.treatments.map((treatment, treatmentIndex) => buildOutcome(entry, treatment, args.analysis.cases[caseIndex].treatments[treatmentIndex])),
    metadata: { benchmarkProject: entry.benchmarkProject, taskLocality: entry.taskLocality }
  }));
  const run: ContextPackGenerationRun = {
    runId: args.runId,
    pluginId: CONTEXT_PACK_GENERATION_PLUGIN_ID,
    startedAt: args.startedAt,
    completedAt: args.completedAt,
    status: aggregateTreatmentStatus(args.caseEvidence.flatMap((entry) => entry.treatments.map((treatment) => treatment.status))),
    target: args.target,
    variants: CONTEXT_PACK_GENERATION_VARIANTS.map((variant) => ({ ...variant })),
    cases,
    metrics: [...toContextPackGenerationRunMetrics(args.analysis), ...args.analysis.cases.flatMap(toContextPackGenerationCaseComparisonMetrics)],
    artifacts: [
      {
        id: "context-pack-generation-execution",
        label: "Context pack generation execution evidence",
        path: args.executionArtifactPath,
        kind: "artifact",
        mimeType: "application/json",
        description: "Matched per-case execution evidence for raw-full-file and context-pack without source text or raw command output."
      },
      {
        id: "context-pack-generation-analysis",
        label: "Context pack generation scientific analysis",
        path: args.analysisArtifactPath,
        kind: "artifact",
        mimeType: "application/json",
        description: "Retrieval-quality metrics, size comparison and matched-case scope aggregates for raw-full-file versus context-pack."
      },
      ...args.packArtifactPaths.map((pack) => ({
        id: `context-pack:${pack.caseId}`,
        label: `Context pack for ${pack.caseId}`,
        path: pack.path,
        kind: "artifact" as const,
        mimeType: "application/json",
        description: "Complete bundled experimental context pack (my-dev-kit-lab-context-pack-experiment-v1).",
        caseId: pack.caseId,
        variantId: "context-pack"
      }))
    ],
    warnings: [],
    // Outcome failures are the authoritative per-treatment failure location.
    failures: [],
    metadata: { executionArtifactPath: args.executionArtifactPath, analysisArtifactPath: args.analysisArtifactPath },
    caseExecutionEvidence: structuredClone(args.caseEvidence) as ContextPackGenerationCaseEvidenceV1[],
    analysis: structuredClone(args.analysis)
  };
  run.summary = summarizeExperimentRun(run);
  return run;
}

function buildOutcome(
  caseEvidence: ContextPackGenerationCaseEvidenceV1,
  treatment: ContextPackGenerationTreatmentEvidenceV1,
  treatmentAnalysis: ContextPackGenerationTreatmentAnalysisV1
): ExperimentOutcome {
  const { caseId, benchmarkProject, taskLocality } = caseEvidence;
  const { treatmentId } = treatment;
  return {
    id: `${caseId}:${treatmentId}`,
    caseId,
    variantId: treatmentId,
    status: treatment.status,
    metrics: toContextPackGenerationOutcomeMetrics(treatmentAnalysis, caseId),
    artifacts: [],
    warnings: [],
    failures: treatment.errors.map((error) => ({ code: error.code, message: error.message, variantId: treatmentId, caseId, recoverable: true })),
    metadata: { benchmarkProject, taskLocality, evidenceAvailability: treatment.availability }
  };
}

function aggregateTreatmentStatus(statuses: readonly ExperimentRunStatus[]): ExperimentRunStatus {
  if (statuses.length === 0) return "skipped";
  if (statuses.every((status) => status === "completed")) return "completed";
  if (statuses.every((status) => status === "skipped")) return "skipped";
  if (statuses.every((status) => status === "failed")) return "failed";
  return "partial";
}

function readCasesInput(inputs: Record<string, unknown> | undefined): EvaluationCase[] {
  const value = inputs?.cases;
  if (!Array.isArray(value)) throw new Error("Context pack generation requires cases input.");
  return value as EvaluationCase[];
}

function readDependenciesInput(inputs: Record<string, unknown> | undefined): Partial<ContextPackGenerationDependencies> | undefined {
  const value = inputs?.contextPackDependencies;
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Partial<ContextPackGenerationDependencies>) : undefined;
}

function readArtifactIo(inputs: Record<string, unknown> | undefined): ContextPackGenerationArtifactIo {
  const value = inputs?.contextPackArtifactIo;
  return value && typeof value === "object" && !Array.isArray(value) ? { ...defaultArtifactIo, ...(value as Partial<ContextPackGenerationArtifactIo>) } : defaultArtifactIo;
}
