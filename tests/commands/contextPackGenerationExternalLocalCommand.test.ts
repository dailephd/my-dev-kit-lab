import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { listDurableFiles, scanDurableOutputDirectory } from "../../scripts/externalLocalPrivacyScan.js";
import { parseRunExperimentArgs, runExperimentRunCommandFromArgs } from "../../src/commands/runExperimentRunCommand.js";
import { RETRIEVAL_QUERY_STRATEGY_IDS } from "../../src/evaluation/retrievalQueryStrategies.js";
import {
  analyzeContextPackGeneration,
  CONTEXT_PACK_IDENTITY_REDACTION,
  executeLocalRepositorySubjectContextPackGeneration,
  projectContextPackAnalysisForExternalLocalPersistence,
  projectContextPackExecutionForExternalLocalPersistence,
  type ContextPackGenerationAnalysisV1,
  type ContextPackGenerationCaseEvidenceV1
} from "../../src/experiments/plugins/contextPackGeneration/index.js";
import { createLabExecutionContext } from "../../src/runtime/index.js";
import { loadLocalRepositorySubject } from "../../src/evaluation/localRepositorySubject/index.js";
import { git, makeTempDir, removeTempDir } from "../evaluation/localRepositorySubject/fixtureRepository.js";
import type { LocalSubjectFixture } from "../experiments/contextWindowScaling/localSubjectFixture.js";
import {
  clearCpgKitEnv,
  CPG_MARKERS,
  cpgKitCommand,
  cpgLocalSubjectCases,
  cpgPrivateSentinels,
  createCpgLocalSubjectFixture,
  hashTree,
  readKitLog
} from "../experiments/contextPackGeneration/externalLocalFixture.js";

vi.setConfig({ testTimeout: 240_000, hookTimeout: 240_000 });

const ID = "context-pack-generation";

let fixture: LocalSubjectFixture;
let dirs: string[];
let parent: string;
let kitCommand: string;
let logPath: string;
let configPath: string;
let outDir: string;

function capture() {
  const out: string[] = [];
  const err: string[] = [];
  vi.spyOn(console, "log").mockImplementation((...a) => void out.push(a.join(" ")));
  vi.spyOn(console, "error").mockImplementation((...a) => void err.push(a.join(" ")));
  return { stdout: () => out.join("\n"), stderr: () => err.join("\n") };
}

beforeEach(async () => {
  dirs = [];
  fixture = await createCpgLocalSubjectFixture();
  parent = makeTempDir("cpg-b5-");
  dirs.push(parent);
  kitCommand = cpgKitCommand();
  logPath = path.join(parent, "kit.log");
  configPath = path.join(parent, "config", "local-subject.json");
  mkdirSync(path.dirname(configPath), { recursive: true });
  writeFileSync(configPath, JSON.stringify({ schemaVersion: "1.0.0", subjectId: "cpg-subject", cases: cpgLocalSubjectCases() }));
  outDir = path.join(parent, "out", "run");
  process.env.CPG_KIT_LOG = logPath;
});

afterEach(() => {
  vi.restoreAllMocks();
  clearCpgKitEnv();
  for (const directory of [...fixture.directories, ...dirs]) removeTempDir(directory);
});

const runArgs = (extra: string[] = []): string[] => ["--experiment", ID, "--target", fixture.root, "--local-subject-config", configPath, "--kit-command", kitCommand, "--out", outDir, ...extra];
const context = () => createLabExecutionContext({ invocationCwd: process.cwd() });
const runCommand = (extra: string[] = []) => runExperimentRunCommandFromArgs(runArgs(extra), { context: context() });
/** The subject exactly as the command loads it: same config file content, default safety policy. */
const loadCommandSubject = () => loadLocalRepositorySubject({ config: JSON.parse(readFileSync(configPath, "utf8")), repositoryPath: fixture.root });
const readJson = (name: string): any => JSON.parse(readFileSync(path.join(outDir, name), "utf8"));

const DURABLE_FAMILY = [
  "context-pack-generation-analysis.json",
  "context-pack-generation-execution.json",
  "local-repository-subject-manifest.json",
  "report.html",
  "report.json",
  "report.txt"
];

/** The recursive file inventory of the output root, or [] when the directory was never created. */
const inventory = (): string[] => (existsSync(outDir) ? listDurableFiles(outDir) : []);

describe("CLI mode matrix for context-pack-generation", () => {
  const parse = (...args: string[]) => parseRunExperimentArgs(["--experiment", ID, ...args]);

  it("keeps bundled mode valid and accepts the exact external-local flag set without any new flag", () => {
    expect(parse("--case", "a", "--benchmark-project", "p", "--out", "o", "--kit-command", "k").config).toMatchObject({ caseIds: ["a"], benchmarkProjects: ["p"], kitCommand: "k" });
    const external = parse("--target", "repo", "--local-subject-config", "cfg.json", "--out", "o", "--kit-command", "k");
    expect(external.targetPath).toBe("repo");
    expect(external.localSubjectConfigPath).toBe("cfg.json");
    expect(external.config).toEqual({ kitCommand: "k" });
  });

  it("rejects bundled filters and unrelated flags in external-local mode exactly like the sibling experiments", () => {
    const external = ["--target", "repo", "--local-subject-config", "cfg.json"];
    expect(() => parse(...external, "--case", "x")).toThrow("--case and --benchmark-project cannot be combined with --local-subject-config; the local subject config owns the case set.");
    expect(() => parse(...external, "--benchmark-project", "x")).toThrow("--case and --benchmark-project cannot be combined with --local-subject-config");
    for (const extra of [["--synthetic-config", "s.json"], ["--context-budgets", "8k"], ["--campaign", "x"], ["--agents", "a"]]) {
      expect(() => parse(...external, ...extra), extra[0]).toThrow();
    }
    expect(() => parse(...external, "--cases", "x")).toThrow(
      `--cases is not supported for --experiment ${ID} in external-local mode; supported options: --experiment, --out, --target, --local-subject-config, --kit-command.`
    );
    expect(() => parse("--target", "repo")).toThrow(`External ${ID} targets require --local-subject-config.`);
    expect(() => parse("--local-subject-config", "cfg.json")).toThrow(`--local-subject-config requires an external --target for ${ID}.`);
  });

  it("leaves the earlier experiments' external-local contracts and the seven v0.8.1 strategies unchanged", () => {
    expect([...RETRIEVAL_QUERY_STRATEGY_IDS]).toHaveLength(7);
    for (const id of ["retrieval-precision-recall", "retrieval-query-strategy-comparison"]) {
      expect(parseRunExperimentArgs(["--experiment", id, "--target", "r", "--local-subject-config", "c.json"]).localSubjectConfigPath).toBe("c.json");
      expect(() => parseRunExperimentArgs(["--experiment", id, "--target", "r", "--local-subject-config", "c.json", "--case", "x"])).toThrow("cannot be combined with --local-subject-config");
    }
  });
});

describe("successful external-local run", () => {
  it("completes, leaves the target byte-for-byte unchanged, and writes exactly the approved durable family", async () => {
    const hashesBefore = hashTree(fixture.root);
    const statusBefore = git(fixture.root, "status", "--porcelain=v1", "--ignored");
    const output = capture();
    const code = await runCommand();
    expect(output.stderr()).toBe("");
    expect(code).toBe(0);
    expect(output.stdout()).toContain("Status: completed");
    expect(output.stdout()).toContain("Mode: external-local repository subject");
    expect(output.stdout()).toContain("Subject: cpg-subject");

    expect(hashTree(fixture.root)).toEqual(hashesBefore);
    expect(git(fixture.root, "status", "--porcelain=v1", "--ignored")).toBe(statusBefore);
    for (const forbidden of [".my-dev-kit", "lab-output", "packs"]) expect(existsSync(path.join(fixture.root, forbidden))).toBe(false);

    // Exact inventory: no packs/, commands/, indexes/ or s-* scratch directory survives, and no pack body exists anywhere.
    expect(inventory()).toEqual(DURABLE_FAMILY);
    expect(readdirSync(outDir, { withFileTypes: true }).every((entry) => entry.isFile())).toBe(true);
    expect(inventory().some((name) => name.includes("context-pack.json") || name.startsWith("packs/"))).toBe(false);
  });

  it("builds one private index per case under a scratch outside the target, with guided exclusions, and removes the scratch", async () => {
    capture();
    expect(await runCommand()).toBe(0);
    const calls = readKitLog(logPath);
    const indexCalls = calls.filter((entry) => entry.argv[0] === "index");
    expect(indexCalls).toHaveLength(2);
    expect(indexCalls.map((entry) => entry.argv.flatMap((value, index) => (value === "--src" ? [entry.argv[index + 1]] : [])))).toEqual([["src"], ["src/zeta-private"]]);
    for (const call of indexCalls) {
      expect(call.argv).toContain("--call-graph");
      expect(call.argv[call.argv.indexOf("--root") + 1]).toBe(fixture.subject.repositoryRoot);
      const excluded = call.argv.flatMap((value, index) => (value === "--exclude" ? [call.argv[index + 1]] : []));
      expect(excluded).toEqual(expect.arrayContaining(["src/gen", "src/huge.ts", "src/ignored.ts"]));
      const indexOut = call.argv[call.argv.indexOf("--out") + 1];
      // Physically outside the target and inside the Lab work root's private scratch.
      expect(path.relative(fixture.root, indexOut).startsWith("..")).toBe(true);
      expect(path.relative(outDir, indexOut).startsWith("..")).toBe(false);
      expect(path.relative(outDir, indexOut).split(path.sep)[0]).toMatch(/^s-/);
    }
    // Every source-bearing command ran against a scratch index; none was pointed at the target or the durable root files.
    for (const call of calls.filter((entry) => ["search", "lookup", "slice", "source"].includes(entry.argv[0]))) {
      const indexDir = call.argv[call.argv.indexOf("--index") + 1];
      expect(path.relative(outDir, indexDir).split(path.sep)[0]).toMatch(/^s-/);
    }
    expect(readdirSync(outDir).some((entry) => /^s-/.test(entry))).toBe(false);
    expect(inventory()).toEqual(DURABLE_FAMILY);
  });

  it("recursively scans EVERY durable output file and its name for every private path, identity, task text and source fragment", async () => {
    const output = capture();
    expect(await runCommand()).toBe(0);
    expect(scanDurableOutputDirectory(outDir, cpgPrivateSentinels({ root: fixture.root, workRoot: fixture.workRoot, outDir, logPath }))).toEqual([]);
    // The console summary stays free of private identities too.
    for (const marker of [CPG_MARKERS.title, CPG_MARKERS.engineFile, CPG_MARKERS.engineSource, fixture.root]) expect(output.stdout()).not.toContain(marker);
    // Sanity: the scan is capable of failing, i.e. the private values really existed in the run.
    const logText = readFileSync(logPath, "utf8");
    expect(logText).toContain(path.basename(fixture.root));
  });

  it("persists the real scientific numbers (calculated before projection) while withholding the identities", async () => {
    capture();
    expect(await runCommand()).toBe(0);

    // Independent real run through the safe seam: same fixture, same kit, real identities in memory.
    const subject = await loadCommandSubject();
    const real = await executeLocalRepositorySubjectContextPackGeneration({ subject, kitCommand, workRoot: path.join(parent, "seam-work") });
    const realEvidence = real.results.map((result) => result.evidence);
    const realAnalysis = analyzeContextPackGeneration(subject.evaluationCases, realEvidence);

    const persisted = readJson("context-pack-generation-analysis.json").analysis as ContextPackGenerationAnalysisV1;
    // Persisted analysis equals the projection of the real analysis: only identity lists differ.
    expect(persisted).toEqual(projectContextPackAnalysisForExternalLocalPersistence(realAnalysis));
    const rawOne = persisted.cases[0].treatments[0];
    const packOne = persisted.cases[0].treatments[1];
    for (const treatment of [rawOne, packOne]) {
      expect(treatment.fileF1.availability).toBe("available");
      expect(treatment.fileF1.value).toBeGreaterThan(0);
      expect(treatment.fileF1.value).toBeLessThan(1);
      expect(treatment.estimatedTokens).toBeGreaterThan(0);
    }
    expect(packOne.fileF1.value).toBeGreaterThan(rawOne.fileF1.value as number);
    expect(packOne.quality?.fact.coverage.availability).toBe("available");
    expect(packOne.quality?.fact.coveredFactIds?.every((id) => /^<redacted fact \d+>$/.test(id))).toBe(true);
    expect(packOne.quality?.file.relevantRetrievedFiles?.every((id) => /^<redacted file \d+>$/.test(id))).toBe(true);
    expect(persisted.scopes.find((scope) => scope.scopeId === "overall")?.includedCaseCount).toBe(2);

    // Placeholder-based scoring would have produced a different (unavailable) result than the real one.
    const projectedEvidence = projectContextPackExecutionForExternalLocalPersistence(real.results);
    const fromPlaceholders = analyzeContextPackGeneration(subject.evaluationCases, projectedEvidence);
    expect(fromPlaceholders.cases[0].treatments[0].fileF1.value).not.toBe(rawOne.fileF1.value);
    expect(fromPlaceholders.cases[0].treatments[1].fileF1.value).not.toBe(packOne.fileF1.value);

    // Token and size values in the durable execution artifact equal the real measured ones.
    const execution = readJson("context-pack-generation-execution.json");
    expect(execution.cases.map((entry: ContextPackGenerationCaseEvidenceV1) => entry.treatments.map((treatment) => treatment.size))).toEqual(
      realEvidence.map((entry) => entry.treatments.map((treatment) => treatment.size))
    );
  });

  it("persists a projected execution artifact: counts, availability and redaction marker only", async () => {
    capture();
    expect(await runCommand()).toBe(0);
    const execution = readJson("context-pack-generation-execution.json");
    expect(execution.schemaVersion).toBe("my-dev-kit-lab-context-pack-generation-execution-v1");
    expect(execution.cases).toHaveLength(2);
    for (const entry of execution.cases as ContextPackGenerationCaseEvidenceV1[]) {
      expect(entry.caseName).toBe("<redacted case title>");
      expect(entry.identityRedaction).toEqual(CONTEXT_PACK_IDENTITY_REDACTION);
      expect(entry.identityRedaction).toMatchObject({
        fileIdentities: "redacted",
        symbolIdentities: "redacted",
        sourceText: "redacted",
        callRelationships: "redacted",
        testIdentities: "redacted",
        factIdentities: "redacted",
        taskText: "redacted",
        warningText: "redacted",
        semanticNodeIds: "redacted"
      });
      const [raw, pack] = entry.treatments;
      expect(raw.identityEvidence).toBeNull();
      expect(pack.identityEvidence).toBeNull();
      expect(raw.includedFiles).toEqual([]);
      expect(pack.includedFiles).toEqual([]);
      expect(raw.identityCounts?.files).toBeGreaterThan(0);
      expect(pack.identityCounts?.files).toBeGreaterThan(0);
      expect(pack.packArtifactPath).toBeNull();
      expect(pack.sections?.map((section) => section.id)).toEqual(["task", "files", "symbols", "sourceSlices", "callRelationships", "tests", "evidenceNotes"]);
      expect(pack.sections?.find((section) => section.id === "sourceSlices")).toMatchObject({ availability: "available" });
      expect(typeof pack.sections?.find((section) => section.id === "sourceSlices")?.truncatedCount).toBe("number");
      expect(pack.steps.every((step) => step.nodeId === null)).toBe(true);
      expect(pack.size?.totalEstimatedTokens).toBeGreaterThan(0);
    }
  });

  it("writes a redacted report preview (counts and placeholders only) in JSON, text and HTML, with unchanged numbers", async () => {
    capture();
    expect(await runCommand()).toBe(0);
    const real = await executeLocalRepositorySubjectContextPackGeneration({ subject: await loadCommandSubject(), kitCommand, workRoot: path.join(parent, "seam-work") });
    const analysis = readJson("context-pack-generation-analysis.json").analysis as ContextPackGenerationAnalysisV1;

    const report = readJson("report.json").report;
    const section = report.contextPackGeneration;
    expect(section.schemaVersion).toBe("my-dev-kit-lab-context-pack-generation-report-v1");
    expect(section.previews).toHaveLength(2);
    for (const [index, preview] of section.previews.entries()) {
      const pack = real.results[index].pack!;
      expect(preview.status).toBe("redacted-external-local");
      expect(preview.status).not.toBe("pack-artifact-unavailable");
      expect(preview.packArtifactPath).toBeNull();
      for (const key of ["task", "files", "symbols", "sourceSlices", "callRelationships", "tests", "evidenceNotes"]) expect(preview[key]).toBeNull();
      expect(preview.redaction).toEqual(CONTEXT_PACK_IDENTITY_REDACTION);
      const counts = Object.fromEntries(preview.sections.map((entry: { id: string; itemCount: number }) => [entry.id, entry.itemCount]));
      expect(counts).toMatchObject({ files: pack.files.length, symbols: pack.symbols.length, sourceSlices: pack.sourceSlices.length, callRelationships: pack.callRelationships.length, tests: pack.tests.length });
      expect(preview.sections.map((entry: { estimatedTokens: number }) => entry.estimatedTokens)).toEqual(pack.sections.map((entry) => entry.estimatedTokens));
    }
    // The report copies the persisted analysis; nothing is recalculated from placeholders.
    expect(section.cases.map((entry: any) => entry.treatments.map((treatment: any) => treatment.fileF1.value))).toEqual(
      analysis.cases.map((entry) => entry.treatments.map((treatment) => treatment.fileF1.value))
    );
    expect(section.scopes).toEqual(analysis.scopes);

    const packOneSections = real.results[0].pack!;
    const text = readFileSync(path.join(outDir, "report.txt"), "utf8");
    const html = readFileSync(path.join(outDir, "report.html"), "utf8");
    for (const document of [text, html]) {
      expect(document).toContain(`Relevant files: ${packOneSections.files.length} items`);
      expect(document).toContain("identities redacted");
      expect(document).toContain("content redacted");
      expect(document).toContain("Task: title and summary redacted");
      expect(document).toContain("redacted-external-local");
      expect(document).not.toContain("pack-artifact-unavailable");
      expect(document).not.toContain("no-pack-produced");
    }
  });

  it("keeps rawRun and every generic report field free of private data", async () => {
    capture();
    expect(await runCommand()).toBe(0);
    const reportJson = readJson("report.json");
    const rawRun = reportJson.report.rawRun;
    expect(rawRun).not.toHaveProperty("caseExecutionEvidence");
    expect(rawRun).not.toHaveProperty("analysis");
    expect(rawRun.target).toMatchObject({ kind: "external-local", isSelf: false, privacyProjection: "external-local-redacted", targetRoot: "local-repository:cpg-subject" });
    expect(rawRun.cases.map((entry: { name: string }) => entry.name)).toEqual(["<redacted case title>", "<redacted case title>"]);
    expect(rawRun.artifacts.map((artifact: { path: string }) => artifact.path).sort()).toEqual([
      "context-pack-generation-analysis.json",
      "context-pack-generation-execution.json",
      "local-repository-subject-manifest.json"
    ]);
    const serialized = JSON.stringify(reportJson);
    expect(serialized).not.toContain(".context-pack.json");
    expect(scanDurableOutputDirectory(outDir, cpgPrivateSentinels({ root: fixture.root, workRoot: fixture.workRoot, outDir, logPath }))).toEqual([]);
  });

  it("writes the subject manifest last-compatible and privacy-clean", async () => {
    capture();
    expect(await runCommand()).toBe(0);
    const manifest = readJson("local-repository-subject-manifest.json");
    expect(manifest.logicalTargetRoot ?? manifest.subject?.logicalTargetRoot ?? "local-repository:cpg-subject").toContain("cpg-subject");
    expect(readFileSync(path.join(outDir, "local-repository-subject-manifest.json"), "utf8")).not.toContain(fixture.root);
  });
});

describe("external-local failure atomicity through the command", () => {
  it("fails an index failure with a fixed message and writes no scientific output or report", async () => {
    process.env.CPG_KIT_INDEX_FAIL = "1";
    const output = capture();
    expect(await runCommand()).toBe(1);
    expect(output.stdout()).toContain("Status: failed");
    expect(output.stdout()).toContain("context-pack index preparation failed for a configured case");
    expect(output.stdout()).not.toContain(CPG_MARKERS.stderr);
    expect(inventory()).toEqual([]);
    expect(readdirSync(path.dirname(outDir)).every((entry) => entry !== "report.json")).toBe(true);
  });

  it("fails a target mutation, never restores it, and writes nothing durable", async () => {
    const mutated = path.join(fixture.root, CPG_MARKERS.engineFile);
    process.env.CPG_KIT_MUTATE_FILE = mutated;
    const before = readFileSync(mutated, "utf8");
    const output = capture();
    expect(await runCommand()).toBe(1);
    expect(output.stdout()).toContain("the target changed during execution");
    expect(output.stdout()).toContain("it was not restored");
    expect(readFileSync(mutated, "utf8")).not.toBe(before);
    expect(readFileSync(mutated, "utf8")).toContain("mutated by the kit");
    expect(inventory()).toEqual([]);
  });

  it("fails an eligible-universe violation with a count only, and writes nothing durable", async () => {
    // src/ignored.ts exists in the repository but is not in the eligible universe.
    process.env.CPG_KIT_SEARCH_EXTRA = "src/ignored.ts";
    const output = capture();
    expect(await runCommand()).toBe(1);
    expect(output.stdout()).toContain("outside the eligible subject universe");
    expect(output.stdout()).not.toContain("ignored.ts");
    expect(inventory()).toEqual([]);
  });

  it("records a retrieval failure with fixed text only: the run completes with the case treatment failed", async () => {
    process.env.CPG_KIT_SEARCH_FAIL = "1";
    const output = capture();
    const code = await runCommand();
    expect(code).toBe(0);
    expect(output.stdout()).toContain("Status: partial");
    const execution = readJson("context-pack-generation-execution.json");
    for (const entry of execution.cases as ContextPackGenerationCaseEvidenceV1[]) {
      const pack = entry.treatments[1];
      expect(pack.status).toBe("failed");
      expect(pack.errors).toEqual([{ code: "retrieval-failed", message: "The context-pack retrieval did not complete." }]);
      expect(pack.packArtifactPath).toBeNull();
    }
    expect(inventory()).toEqual(DURABLE_FAMILY);
    expect(scanDurableOutputDirectory(outDir, cpgPrivateSentinels({ root: fixture.root, workRoot: fixture.workRoot, outDir, logPath }))).toEqual([]);
  });

  it("refuses an output root inside the target before anything is created", async () => {
    const inside = path.join(fixture.root, "lab-out");
    const hashesBefore = hashTree(fixture.root);
    const output = capture();
    expect(await runExperimentRunCommandFromArgs(["--experiment", ID, "--target", fixture.root, "--local-subject-config", configPath, "--kit-command", kitCommand, "--out", inside], { context: context() })).toBe(1);
    expect(output.stderr()).toContain("Experiment output root must not be inside the external target project.");
    expect(existsSync(inside)).toBe(false);
    expect(hashTree(fixture.root)).toEqual(hashesBefore);
    expect(readKitLog(logPath)).toEqual([]);
  });
});

describe("bundled behavior is unchanged by the external-local path", () => {
  it("still routes a run without --target through the bundled corpus filter validation", async () => {
    const output = capture();
    expect(await runExperimentRunCommandFromArgs(["--experiment", ID, "--kit-command", kitCommand, "--out", path.join(parent, "bundled"), "--case", "no-such-case"], { context: context() })).not.toBe(0);
    expect(output.stdout()).toContain("Mode: self");
    expect(output.stdout()).toContain("Status: failed");
    expect(readFileSync(path.join(parent, "bundled", "report.json"), "utf8")).toContain("Evaluation case not found: no-such-case");
  });
});
