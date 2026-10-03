import { createHash } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parseRunExperimentArgs } from "../../../src/commands/runExperimentRunCommand.js";
import { renderExperimentRunHelp } from "../../../src/cli/help.js";
import { scoreCorrectness } from "../../../src/evaluation/scoreCorrectness.js";
import { runRawFullFileBaseline } from "../../../src/evaluation/runRawFullFileBaseline.js";
import type { BenchmarkProjectProfile, EvaluationCase } from "../../../src/evaluation/types.js";
import { tokenCountMethod } from "../../../src/core/countTokens.js";
import {
  SyntheticRepositoryConfigError,
  SyntheticRepositoryMaterializationError,
  verifySyntheticRepositoryMaterialization,
} from "../../../src/evaluation/syntheticRepository/index.js";
import {
  CONTEXT_WINDOW_SCALING_EXECUTION_ARTIFACT_FILE,
  CONTEXT_WINDOW_SCALING_EXECUTION_SCHEMA_VERSION,
  SYNTHETIC_REPOSITORIES_OUTPUT_SUBDIRECTORY,
  computeRelevantFileEvidence,
  contextWindowScalingConfigDefinition,
  contextWindowScalingPlugin,
  executeContextWindowScalingCases,
  parseContextWindowScalingExecutionArtifact,
  prepareSyntheticContextWindowScalingInputs,
  validateContextWindowScalingConfig,
  type ContextWindowScalingDependencies,
  type ContextWindowScalingRun,
  type TreatmentEvaluationResult,
} from "../../../src/experiments/plugins/contextWindowScaling/index.js";
import { buildContextWindowScalingReport } from "../../../src/report/experiments/buildContextWindowScalingReport.js";
import {
  CONTEXT_WINDOW_SCALING_PLOT_IDS,
  buildContextWindowScalingPlotData,
  readContextWindowScalingPlotSource,
} from "../../../src/plots/buildContextWindowScalingPlotData.js";
import type { ExperimentExecutionContext, ExperimentTarget } from "../../../src/experiments/types.js";

const rootDir = process.cwd();
const tempDirs: string[] = [];
afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
function tempDir(label = "ctx-scaling-synth-"): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), label));
  tempDirs.push(dir);
  return dir;
}

const SMALL_TS = { id: "synth-ts", language: "typescript", seed: "ctx", sourceFileCount: 6, moduleDepth: 3, internalImportCount: 6, symbolCount: 12, testFileCount: 3, taskLocality: "cross-module", repeatedPatternCount: 3 };
const SMALL_PY = { id: "synth-py", language: "python", seed: "ctx", sourceFileCount: 6, moduleDepth: 3, internalImportCount: 6, symbolCount: 12, testFileCount: 3, taskLocality: "localized", repeatedPatternCount: 3 };
const LARGER_TS = { id: "synth-ts-large", language: "typescript", seed: "ctx", sourceFileCount: 40, moduleDepth: 6, internalImportCount: 60, symbolCount: 160, testFileCount: 10, taskLocality: "broad-change", repeatedPatternCount: 40 };
const config = (...cases: unknown[]) => ({ schemaVersion: "1.0.0", cases });

const target: ExperimentTarget = {
  kind: "self",
  targetRoot: rootDir,
  toolRoot: rootDir,
  packageName: null,
  packageVersion: null,
  hasPackageJson: true,
  hasLockfile: true,
  branch: null,
  commit: null,
  hasGit: false,
  isSelf: true,
};

/** Deterministic offline stand-in for my-dev-kit that works on any generated repository (search by sym_ name). */
const GENERIC_FAKE_KIT = [
  'const fs = require("node:fs");',
  'const path = require("node:path");',
  "const args = process.argv.slice(2);",
  "const arg = (flag) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : undefined; };",
  "const command = args[0];",
  'if (command === "index") {',
  '  const out = arg("--out"); fs.mkdirSync(out, { recursive: true });',
  '  fs.writeFileSync(path.join(out, "manifest.json"), JSON.stringify({ ok: true, root: arg("--root") }));',
  "  console.log(JSON.stringify({ ok: true })); process.exit(0);",
  "}",
  'const root = () => JSON.parse(fs.readFileSync(path.join(arg("--index"), "manifest.json"), "utf8")).root;',
  "const find = (dir, name) => { for (const e of fs.readdirSync(dir, { withFileTypes: true })) { const p = path.join(dir, e.name);",
  "  if (e.isDirectory()) { const r = find(p, name); if (r) return r; }",
  '  else if (/\\.(ts|py)$/.test(e.name) && new RegExp("(export function|def) " + name + "\\\\(").test(fs.readFileSync(p, "utf8"))) return p; } return null; };',
  'if (command === "search") {',
  '  const m = /sym_\\d+/.exec(arg("--query") || ""); let results = [];',
  "  if (m) { const file = find(root(), m[0]); if (file) { const rel = path.relative(root(), file).split(path.sep).join('/');",
  "    results = [{ nodeId: 'symbol:' + rel + '#' + m[0], file: rel, symbol: m[0] }]; } }",
  "  console.log(JSON.stringify({ results })); process.exit(0);",
  "}",
  'if (command === "lookup" || command === "slice") { console.log(JSON.stringify({ nodeId: arg("--node"), command })); process.exit(0); }',
  'if (command === "source") {',
  '  const node = arg("--node") || ""; const rel = node.slice(node.indexOf("symbol:") + 7, node.indexOf("#"));',
  '  const lines = fs.readFileSync(path.join(root(), rel), "utf8").split("\\n");',
  '  process.stdout.write(lines.map((l, i) => (i + 1) + " " + l).join("\\n")); process.exit(0);',
  "}",
  'process.stderr.write("unsupported " + command); process.exit(1);',
].join("\n");

function writeFakeKit(): string {
  const dir = tempDir("ctx-fake-kit-");
  const script = path.join(dir, "generic-fake-kit.cjs");
  writeFileSync(script, GENERIC_FAKE_KIT);
  return `node ${script}`;
}

function contextFor(outputRoot: string, inputs: Record<string, unknown>, kit: string): ExperimentExecutionContext<{ contextBudgets: number[]; kitCommand: string }> {
  return {
    runId: "synthetic-run",
    startedAt: new Date("2026-01-01T00:00:00.000Z"),
    toolRoot: rootDir,
    target,
    config: { contextBudgets: [8192, 16384, 32768, 65536], kitCommand: kit },
    outputRoot,
    inputs,
  };
}

function snapshotTree(directory: string): Record<string, string> {
  const result: Record<string, string> = {};
  const walk = (current: string): void => {
    for (const entry of readdirSync(current).sort()) {
      const full = path.join(current, entry);
      if (statSync(full).isDirectory()) walk(full);
      else result[path.relative(directory, full).split(path.sep).join("/")] = createHash("sha256").update(readFileSync(full)).digest("hex");
    }
  };
  walk(directory);
  return result;
}

const PASS: TreatmentEvaluationResult = {
  agentId: "fake-agent",
  agentStatus: "completed",
  correctness: { availability: "available", score: 1, pass: true },
  failureReasons: [],
  warnings: [],
  errors: [],
};

describe("synthetic input preparation bridge", () => {
  it("prepares existing EvaluationCase objects and in-memory profiles for TypeScript and Python in normalized case order", () => {
    const out = tempDir();
    const prepared = prepareSyntheticContextWindowScalingInputs({ syntheticRepositoryConfig: config(SMALL_TS, SMALL_PY), outputRoot: out });
    expect(prepared.cases.map((entry) => entry.id)).toEqual(["synth-py-task", "synth-ts-task"]);
    expect(prepared.materializations.map((entry) => entry.caseId)).toEqual(["synth-py", "synth-ts"]);
    expect(prepared.syntheticOutputRoot).toBe(path.join(out, SYNTHETIC_REPOSITORIES_OUTPUT_SUBDIRECTORY));
    for (const entry of prepared.materializations) {
      expect(entry.reusedExistingMaterialization).toBe(false);
      expect(entry.generationIdentity).toMatch(/^[0-9a-f]{64}$/);
      expect(entry.repositoryContentIdentity).toMatch(/^[0-9a-f]{64}$/);
      expect(path.relative(realpathSync(prepared.syntheticOutputRoot), entry.repositoryRoot).split(path.sep)).toEqual([entry.caseId, "repository"]);
      expect(entry.evaluationCase.absoluteTargetRoot).toBe(entry.repositoryRoot);
      expect(entry.evaluationCase.targetRoot).toBe(`synthetic/${entry.caseId}/repository`);
      expect(verifySyntheticRepositoryMaterialization({ manifestPath: entry.manifestPath, repositoryRoot: entry.repositoryRoot }).ok).toBe(true);
    }
    expect(prepared.projectProfiles.map((profile) => profile.projectId)).toEqual(prepared.cases.map((entry) => entry.benchmarkProject));
    const languages = (profile: BenchmarkProjectProfile): string[] => JSON.stringify(profile).match(/typescript|python/gi) ?? [];
    expect(languages(prepared.projectProfiles[0]).join(",").toLowerCase()).toContain("python");
    expect(languages(prepared.projectProfiles[1]).join(",").toLowerCase()).toContain("typescript");
    // Nothing leaves the supplied experiment output root.
    expect(readdirSync(out)).toEqual([SYNTHETIC_REPOSITORIES_OUTPUT_SUBDIRECTORY]);
  });

  it("orders cases by the normalized configuration, not by input order", () => {
    const forward = prepareSyntheticContextWindowScalingInputs({ syntheticRepositoryConfig: config(SMALL_TS, SMALL_PY), outputRoot: tempDir() });
    const backward = prepareSyntheticContextWindowScalingInputs({ syntheticRepositoryConfig: config(SMALL_PY, SMALL_TS), outputRoot: tempDir() });
    expect(backward.materializations.map((entry) => [entry.caseId, entry.generationIdentity, entry.repositoryContentIdentity, entry.evaluationCase.targetRoot])).toEqual(
      forward.materializations.map((entry) => [entry.caseId, entry.generationIdentity, entry.repositoryContentIdentity, entry.evaluationCase.targetRoot])
    );
  });

  it("is idempotent for the same config and output root and rewrites nothing", () => {
    const out = tempDir();
    const first = prepareSyntheticContextWindowScalingInputs({ syntheticRepositoryConfig: config(SMALL_TS, SMALL_PY), outputRoot: out });
    const before = snapshotTree(out);
    const mtimes = first.materializations.map((entry) => statSync(entry.manifestPath).mtimeMs);
    const second = prepareSyntheticContextWindowScalingInputs({ syntheticRepositoryConfig: config(SMALL_TS, SMALL_PY), outputRoot: out });
    expect(second.materializations.every((entry) => entry.reusedExistingMaterialization)).toBe(true);
    expect(second.materializations.map((entry) => [entry.caseId, entry.generationIdentity, entry.repositoryContentIdentity])).toEqual(
      first.materializations.map((entry) => [entry.caseId, entry.generationIdentity, entry.repositoryContentIdentity])
    );
    expect(second.cases.map((entry) => entry.targetRoot)).toEqual(first.cases.map((entry) => entry.targetRoot));
    expect(snapshotTree(out)).toEqual(before);
    expect(second.materializations.map((entry) => statSync(entry.manifestPath).mtimeMs)).toEqual(mtimes);
  });

  it("fails closed before any case exists for invalid, empty, infeasible, colliding and unverifiable inputs", () => {
    const out = tempDir();
    const prepare = (syntheticRepositoryConfig: unknown, outputRoot = out) => prepareSyntheticContextWindowScalingInputs({ syntheticRepositoryConfig, outputRoot });
    expect(() => prepare({ schemaVersion: "9.9.9", cases: [SMALL_TS] })).toThrow(SyntheticRepositoryConfigError);
    expect(() => prepare(config())).toThrow(SyntheticRepositoryConfigError);
    expect(() => prepare(null)).toThrow(SyntheticRepositoryConfigError);
    expect(() => prepare(config({ ...SMALL_TS, internalImportCount: 9999 }))).toThrow(SyntheticRepositoryConfigError);
    expect(existsSync(path.join(out, SYNTHETIC_REPOSITORIES_OUTPUT_SUBDIRECTORY))).toBe(false);

    const good = prepare(config(SMALL_TS, SMALL_PY));
    // collision: a different generation under an existing case id
    expect(() => prepare(config({ ...SMALL_TS, seed: "different" }))).toThrow(SyntheticRepositoryMaterializationError);
    // verification failure: a materialized file drifted
    const drifted = good.materializations[1];
    const file = path.join(drifted.repositoryRoot, "package.json");
    writeFileSync(file, `${readFileSync(file, "utf8")}\n`);
    expect(() => prepare(config(SMALL_TS, SMALL_PY))).toThrow(SyntheticRepositoryMaterializationError);
    // foreign existing child
    const foreignOut = tempDir();
    mkdirSync(path.join(foreignOut, SYNTHETIC_REPOSITORIES_OUTPUT_SUBDIRECTORY, "synth-ts"), { recursive: true });
    writeFileSync(path.join(foreignOut, SYNTHETIC_REPOSITORIES_OUTPUT_SUBDIRECTORY, "synth-ts", "foreign.txt"), "x");
    expect(() => prepare(config(SMALL_TS), foreignOut)).toThrow(/collision/);
  });

  it("refuses a synthetic subtree that is a link resolving outside the experiment output root", () => {
    const out = tempDir();
    const outside = tempDir("ctx-synth-outside-");
    try {
      symlinkSync(outside, path.join(out, SYNTHETIC_REPOSITORIES_OUTPUT_SUBDIRECTORY), process.platform === "win32" ? "junction" : "dir");
    } catch {
      return; // links unavailable on this filesystem
    }
    expect(() => prepareSyntheticContextWindowScalingInputs({ syntheticRepositoryConfig: config(SMALL_TS), outputRoot: out })).toThrow(/outside the experiment output root/);
    expect(readdirSync(outside)).toEqual([]);
    expect(lstatSync(path.join(out, SYNTHETIC_REPOSITORIES_OUTPUT_SUBDIRECTORY)).isSymbolicLink()).toBe(true);
  });

  it("does not touch the repository, benchmarks, src, tests or cwd", () => {
    const before = readdirSync(rootDir).sort();
    const out = tempDir();
    prepareSyntheticContextWindowScalingInputs({ syntheticRepositoryConfig: config(SMALL_PY), outputRoot: out });
    expect(readdirSync(rootDir).sort()).toEqual(before);
    expect(readdirSync(out)).toEqual([SYNTHETIC_REPOSITORIES_OUTPUT_SUBDIRECTORY]);
  });
});

describe("generated cases through the existing context-window execution", () => {
  it("applies existing fit semantics around the measured raw baseline and constructs each context once", async () => {
    const out = tempDir();
    const prepared = prepareSyntheticContextWindowScalingInputs({ syntheticRepositoryConfig: config(SMALL_TS, SMALL_PY), outputRoot: out });
    const before = snapshotTree(prepared.syntheticOutputRoot);
    const counters = { raw: 0, guided: 0, evaluated: [] as string[] };
    const measured = new Map<string, number>();
    for (const entry of prepared.cases) measured.set(entry.id, (await runRawFullFileBaseline(entry)).totalEstimatedTokens);

    const results = await Promise.all(
      prepared.cases.map(async (generated) => {
        const raw = measured.get(generated.id) as number;
        const dependencies: Partial<ContextWindowScalingDependencies> = {
          constructRawContext: async (evaluationCase) => {
            counters.raw += 1;
            return runRawFullFileBaseline(evaluationCase);
          },
          constructGuidedContext: async ({ evaluationCase }) => {
            counters.guided += 1;
            return {
              caseId: evaluationCase.id,
              skipped: false,
              warnings: [],
              totalChars: 40,
              totalEstimatedTokens: 10,
              tokenCountMethod,
              contextText: "",
              filesRead: [evaluationCase.expectedFiles[0]],
              commands: [],
              durationMs: 0,
            };
          },
          evaluateTreatment: async ({ evaluationCase, treatment }) => {
            counters.evaluated.push(`${evaluationCase.id}:${treatment}`);
            return PASS;
          },
        };
        const evidence = await executeContextWindowScalingCases({
          cases: [generated],
          contextBudgets: [raw - 1, raw, raw + 1],
          kitCommand: "unused",
          outputRoot: tempDir(),
          projectProfiles: prepared.projectProfiles,
          cwd: rootDir,
          dependencies,
        });
        return { raw, evidence: evidence[0] };
      })
    );
    for (const { raw, evidence } of results) {
      const rawTreatment = evidence.treatments.find((treatment) => treatment.variantId === "raw-full-file")!;
      expect(rawTreatment.context.estimatedTokens).toBe(raw);
      expect(rawTreatment.context.tokenCountMethod).toBe("estimated_chars_div_4");
      expect(rawTreatment.budgetCells.map((cell) => cell.contextFitStatus)).toEqual(["context-too-large", "fits", "fits"]);
      const guided = evidence.treatments.find((treatment) => treatment.variantId === "my-dev-kit-guided")!;
      expect(guided.budgetCells.every((cell) => cell.contextFitStatus === "fits" || cell.contextFitStatus === "context-too-large")).toBe(true);
    }
    expect(counters.raw).toBe(prepared.cases.length);
    expect(counters.guided).toBe(prepared.cases.length);
    expect(counters.evaluated.length).toBe(prepared.cases.length * 2);
    // Generation happened once during preparation; execution never touched the generated repositories.
    expect(snapshotTree(prepared.syntheticOutputRoot)).toEqual(before);
  });

  it("consumes measured evidence for materially different generated sizes", async () => {
    const prepared = prepareSyntheticContextWindowScalingInputs({ syntheticRepositoryConfig: config(SMALL_TS, LARGER_TS), outputRoot: tempDir() });
    const tokens = await Promise.all(prepared.cases.map(async (entry) => (await runRawFullFileBaseline(entry)).totalEstimatedTokens));
    expect(tokens[0]).not.toBe(tokens[1]);
    const evidence = await executeContextWindowScalingCases({
      cases: prepared.cases,
      contextBudgets: [Math.min(...tokens), Math.max(...tokens)],
      kitCommand: "unused",
      outputRoot: tempDir(),
      projectProfiles: prepared.projectProfiles,
      cwd: rootDir,
      dependencies: {
        constructGuidedContext: async ({ evaluationCase }) => ({ caseId: evaluationCase.id, skipped: true, warnings: ["skipped"], totalChars: 0, totalEstimatedTokens: 0, tokenCountMethod, contextText: "", filesRead: [], commands: [], durationMs: 0 }),
        evaluateTreatment: async () => PASS,
      },
    });
    expect(evidence.map((entry) => entry.treatments[0].context.estimatedTokens)).toEqual(tokens);
  });

  it("keeps raw baseline semantics for generated cases: globs, support-file exclusion, headers, estimator", async () => {
    const prepared = prepareSyntheticContextWindowScalingInputs({ syntheticRepositoryConfig: config(SMALL_TS, SMALL_PY), outputRoot: tempDir() });
    for (const entry of prepared.materializations) {
      const baseline = await runRawFullFileBaseline(entry.evaluationCase);
      expect(baseline.tokenCountMethod).toBe(tokenCountMethod);
      expect(baseline.filesIncluded.some((file) => /(^|\/)(package\.json|tsconfig\.json|pyproject\.toml)$/.test(file))).toBe(false);
      for (const expected of entry.evaluationCase.expectedFiles) expect(baseline.filesIncluded).toContain(expected);
      const manifest = JSON.parse(readFileSync(entry.manifestPath, "utf8")) as { aggregate: { estimatedContentTokens: number } };
      // headers/separators make the baseline a different metric from the manifest content estimate
      expect(baseline.totalEstimatedTokens).not.toBe(manifest.aggregate.estimatedContentTokens);
    }
  });

  it("evaluates relevant-file evidence with the existing logic for raw and guided treatments", async () => {
    const prepared = prepareSyntheticContextWindowScalingInputs({ syntheticRepositoryConfig: config(SMALL_TS), outputRoot: tempDir() });
    const generated = prepared.cases[0];
    const guidedFiles = [generated.expectedFiles[0], "src/not-in-plan.ts"];
    const [evidence] = await executeContextWindowScalingCases({
      cases: [generated],
      contextBudgets: [1_000_000],
      kitCommand: "unused",
      outputRoot: tempDir(),
      projectProfiles: prepared.projectProfiles,
      cwd: rootDir,
      dependencies: {
        constructGuidedContext: async () => ({ caseId: generated.id, skipped: false, warnings: [], totalChars: 8, totalEstimatedTokens: 2, tokenCountMethod, contextText: "", filesRead: guidedFiles, commands: [], durationMs: 0 }),
        evaluateTreatment: async () => PASS,
      },
    });
    const raw = evidence.treatments.find((treatment) => treatment.variantId === "raw-full-file")!;
    const guided = evidence.treatments.find((treatment) => treatment.variantId === "my-dev-kit-guided")!;
    const baseline = await runRawFullFileBaseline(generated);
    expect(raw.relevantFileEvidence).toEqual(computeRelevantFileEvidence({ expectedFiles: generated.answerKey!.expectedFiles, observedFiles: baseline.filesIncluded }));
    expect(guided.relevantFileEvidence).toEqual(computeRelevantFileEvidence({ expectedFiles: generated.answerKey!.expectedFiles, observedFiles: guidedFiles }));
    expect(JSON.stringify(raw.relevantFileEvidence)).not.toMatch(/omit.*[1-9]/i);
  });

  it("scores generated answer keys with the existing scorer", () => {
    const prepared = prepareSyntheticContextWindowScalingInputs({ syntheticRepositoryConfig: config(SMALL_TS, SMALL_PY), outputRoot: tempDir() });
    for (const generated of prepared.cases) {
      const key = generated.answerKey!;
      const score = scoreCorrectness({
        caseId: generated.id,
        answerKey: key,
        parsedAnswer: { answerText: "", relevantFiles: key.expectedFiles, relevantSymbols: key.expectedSymbols, expectedFactsFound: key.expectedFacts.map((fact) => fact.id), commandsRun: [], selectedContext: [], fullFileReads: [], fullFileReadJustifications: [], parseStatus: "parsed", warnings: [] },
      });
      expect(score.passed).toBe(true);
    }
  });
});

describe("generated cases through contextWindowScalingPlugin.run (existing production owners)", () => {
  it("runs TypeScript and Python generated cases end to end with the unchanged V1 artifact, report and plots", async () => {
    const out = tempDir();
    const prepared = prepareSyntheticContextWindowScalingInputs({ syntheticRepositoryConfig: config(SMALL_TS, SMALL_PY), outputRoot: out });
    const before = snapshotTree(prepared.syntheticOutputRoot);
    const run: ContextWindowScalingRun = await contextWindowScalingPlugin.run(
      contextFor(out, { cases: prepared.cases, projectProfiles: prepared.projectProfiles }, writeFakeKit())
    );
    expect(run.executionEvidence.map((entry) => entry.caseId)).toEqual(prepared.cases.map((entry) => entry.id));
    for (const entry of run.executionEvidence) {
      expect(entry.treatments.map((treatment) => treatment.variantId)).toEqual(["raw-full-file", "my-dev-kit-guided"]);
      const guided = entry.treatments[1];
      expect(guided.context.status).toBe("available");
      for (const treatment of entry.treatments) {
        expect(treatment.evaluation.status, `${entry.caseId}/${treatment.variantId}`).toBe("evaluated");
        expect(treatment.evaluation.agentId).toBe("fake-agent");
      }
    }
    // The generated repositories were not regenerated or modified by the run.
    expect(snapshotTree(prepared.syntheticOutputRoot)).toEqual(before);

    const artifactPath = path.join(out, CONTEXT_WINDOW_SCALING_EXECUTION_ARTIFACT_FILE);
    const text = readFileSync(artifactPath, "utf8");
    const artifact = parseContextWindowScalingExecutionArtifact(JSON.parse(text));
    expect(artifact.schemaVersion).toBe(CONTEXT_WINDOW_SCALING_EXECUTION_SCHEMA_VERSION);
    expect(artifact.cases.map((entry) => entry.caseId)).toEqual(prepared.cases.map((entry) => entry.id));
    for (const forbidden of [out, out.split(path.sep).join("/"), JSON.stringify(out).slice(1, -1), "synthetic-repository-manifest", "repositoryContentIdentity", "generationIdentity", ".synthetic-staging"]) {
      expect(text, forbidden).not.toContain(forbidden);
    }
    for (const entry of prepared.materializations) {
      expect(text).not.toContain(entry.repositoryRoot);
      expect(text).not.toContain(JSON.stringify(entry.repositoryRoot).slice(1, -1));
    }

    const report = buildContextWindowScalingReport(run as never);
    expect(report).not.toBeNull();
    const source = await readContextWindowScalingPlotSource(out);
    expect(source).not.toBeNull();
    const plot = buildContextWindowScalingPlotData({ aggregate: source!.aggregate, experimentDir: out, generatedAt: source!.generatedAt });
    expect(plot.plots.map((series) => series.id)).toEqual([...CONTEXT_WINDOW_SCALING_PLOT_IDS]);
  });
});

describe("synthetic selector stays out of the scientific plugin config", () => {
  it("keeps the plugin config fields and rejects synthetic selectors as plugin config", () => {
    expect(contextWindowScalingConfigDefinition.fields.map((field) => field.name)).toEqual(["contextBudgets", "kitCommand"]);
    for (const key of ["syntheticConfig", "syntheticRepositoryConfig", "syntheticConfigPath"]) {
      expect(validateContextWindowScalingConfig({ [key]: "x.json" }).valid).toBe(false);
    }
    const parsed = parseRunExperimentArgs(["--experiment", "context-window-scaling", "--synthetic-config", "x.json"]);
    expect(parsed.syntheticConfigPath).toBe("x.json");
    expect(parsed.config).toEqual({});
    expect(renderExperimentRunHelp()).toContain("--synthetic-config <path>");
  });
});
