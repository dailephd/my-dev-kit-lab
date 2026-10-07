import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { checkRetrievalRedactionTruthfulness, scanDurableOutputDirectory, type PrivacySentinel } from "../../scripts/externalLocalPrivacyScan.js";
import { parseRunExperimentArgs, runExperimentRunCommandFromArgs } from "../../src/commands/runExperimentRunCommand.js";
import { loadLocalRepositorySubject, serializeLocalRepositorySubjectManifest } from "../../src/evaluation/localRepositorySubject/index.js";
import { createLabExecutionContext } from "../../src/runtime/index.js";
import { commitAll, git, initRepository, makeTempDir, removeTempDir, tryCreateSymlink, writeRepositoryFile } from "../evaluation/localRepositorySubject/fixtureRepository.js";
import { listTree } from "../experiments/contextWindowScaling/localSubjectFixture.js";
import type { LocalSubjectFixture } from "../experiments/contextWindowScaling/localSubjectFixture.js";
import { createRprLocalSubjectFixture, readKitLog, RPR_MARKERS, rprLocalSubjectCases, writeUpstreamShapedKit } from "../experiments/retrievalPrecisionRecall/localSubjectFixture.js";

vi.setConfig({ testTimeout: 180_000, hookTimeout: 180_000 });

const ID = "retrieval-precision-recall";
const KIT_ENV = ["RPR_KIT_LOG", "RPR_KIT_FILES", "RPR_KIT_SYMBOLS", "RPR_KIT_MUTATE_FILE", "RPR_KIT_FAIL", "RPR_KIT_INDEX_FAIL"];

let fixture: LocalSubjectFixture;
let dirs: string[];
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

function writeConfig(target: string, cases: Record<string, unknown>[] = rprLocalSubjectCases()): void {
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, JSON.stringify({ schemaVersion: "1.0.0", subjectId: "rpr-subject", cases }));
}

beforeEach(async () => {
  dirs = [];
  fixture = await createRprLocalSubjectFixture();
  const parent = makeTempDir("rpr-b4-");
  dirs.push(parent);
  kitCommand = writeUpstreamShapedKit(path.join(parent, "kit")).command;
  logPath = path.join(parent, "kit.log");
  configPath = path.join(parent, "config", "local-subject.json");
  writeConfig(configPath);
  outDir = path.join(parent, "out", "run");
  process.env.RPR_KIT_LOG = logPath;
  process.env.RPR_KIT_FILES = "src/main.ts,src/util/helper.ts";
  process.env.RPR_KIT_SYMBOLS = `${RPR_MARKERS.symbol}@src/main.ts`;
});

afterEach(() => {
  vi.restoreAllMocks();
  for (const name of KIT_ENV) delete process.env[name];
  for (const directory of [...fixture.directories, ...dirs]) removeTempDir(directory);
});

const runArgs = (extra: string[] = []): string[] => ["--experiment", ID, "--target", fixture.root, "--local-subject-config", configPath, "--kit-command", kitCommand, "--out", outDir, ...extra];
const context = () => createLabExecutionContext({ invocationCwd: process.cwd() });

function walkFiles(directory: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) found.push(...walkFiles(full));
    else found.push(path.relative(directory, full).replace(/\\/g, "/"));
  }
  return found.sort();
}

const DURABLE_FAMILY = ["local-repository-subject-manifest.json", "report.html", "report.json", "report.txt", "retrieval-precision-recall-execution.json"];

/** Every private value an external-local durable output must never contain, including every path form. */
function privateSentinels(extraPaths: string[] = []): PrivacySentinel[] {
  // Only index invocations carry --out; other commands would otherwise contribute unrelated words as "paths".
  const scratchPaths = readKitLog(logPath)
    .filter((entry) => entry.argv[0] === "index" && entry.argv.includes("--out"))
    .map((entry) => entry.argv[entry.argv.indexOf("--out") + 1])
    .filter((value): value is string => typeof value === "string" && path.isAbsolute(value));
  const paths = [fixture.root, path.dirname(fixture.root), fixture.workRoot, outDir, path.dirname(outDir), path.dirname(path.dirname(outDir)), process.cwd(), os.homedir(), os.tmpdir(), ...scratchPaths, ...scratchPaths.map((value) => path.dirname(value)), ...extraPaths];
  const texts = [
    ...Object.values(RPR_MARKERS),
    path.basename(fixture.root),
    "src/main.ts",
    "src/util/helper.ts",
    "main.ts",
    "helper.ts",
    "ignored.ts",
    "gen/out",
    "huge.ts",
    "linked.ts",
    "secret.ts",
    "ELIGIBLE_MARKER_7f3a",
    "IGNORED_FILE_MARKER_91bc",
    "OVERSIZED_MARKER_55aa",
    "SYMLINK_TARGET_MARKER_c0de",
    // Directory leftovers (commands/, indexes/, s-*) are proven absent by the exact durable file-set assertions; the word
    // "commands" is also a legitimate key of the normalized command evidence, so it is not a text sentinel.
    "upstream-shaped-kit"
  ];
  return [...paths.map((value) => ({ label: "private path", value, kind: "path" as const })), ...texts.map((value) => ({ label: "private text", value, kind: "text" as const }))];
}

describe("CLI mode matrix for retrieval-precision-recall", () => {
  const parse = (...args: string[]) => parseRunExperimentArgs(["--experiment", ID, ...args]);

  it("TST-B4-001 keeps bundled mode valid with --case, --benchmark-project, --out and --kit-command", () => {
    const parsed = parse("--case", "a,b", "--benchmark-project", "p", "--out", "o", "--kit-command", "kit");
    expect(parsed.targetPath).toBeUndefined();
    expect(parsed.localSubjectConfigPath).toBeUndefined();
    expect(parsed.config).toEqual({ caseIds: ["a", "b"], benchmarkProjects: ["p"], kitCommand: "kit" });
  });

  it("TST-B4-002 accepts external mode with --target, --local-subject-config, --out and --kit-command, keeping paths out of the plugin config", () => {
    const parsed = parse("--target", "repo", "--local-subject-config", "cfg.json", "--out", "o", "--kit-command", "kit");
    expect(parsed.targetPath).toBe("repo");
    expect(parsed.localSubjectConfigPath).toBe("cfg.json");
    expect(parsed.syntheticConfigPath).toBeUndefined();
    expect(parsed.config).toEqual({ kitCommand: "kit" });
  });

  it("TST-B4-003 rejects --case, --benchmark-project and every unrelated flag in external mode", () => {
    const external = ["--target", "repo", "--local-subject-config", "cfg.json"];
    expect(() => parse(...external, "--case", "a")).toThrow("--case and --benchmark-project cannot be combined with --local-subject-config; the local subject config owns the case set.");
    expect(() => parse(...external, "--benchmark-project", "p")).toThrow(/cannot be combined with --local-subject-config/);
    const unrelated: string[][] = [
      ["--cases", "x.json"],
      ["--project-profiles", "x.json"],
      ["--synthetic-config", "x.json"],
      ["--agents", "fake-agent"],
      ["--strategies", "raw-full-file"],
      ["--complexities", "short"],
      ["--timeout-ms", "100"],
      ["--max-runs", "1"],
      ["--continue-on-failure"],
      ["--no-continue-on-failure"],
      ["--require-agents"],
      ["--include-real-agents"],
      ["--command-template-codex", "codex {prompt}"],
      ["--command-template-claude", "claude {prompt}"],
      ["--context-budgets", "8k"],
      ["--campaign", "some-campaign"],
      ["--no-screenshot"]
    ];
    for (const extra of unrelated) expect(() => parse(...external, ...extra), extra[0]).toThrow();
    expect(() => parse(...external, "--cases", "x", "--agents", "fake-agent")).toThrow(
      `--cases, --agents are not supported for --experiment ${ID} in external-local mode; supported options: --experiment, --out, --target, --local-subject-config, --kit-command.`
    );
  });

  it("TST-B4-004/005 rejects --target without --local-subject-config and the reverse, with no precedence rules", () => {
    expect(() => parse("--target", "repo")).toThrow(`External ${ID} targets require --local-subject-config.`);
    expect(() => parse("--local-subject-config", "cfg.json")).toThrow(`--local-subject-config requires an external --target for ${ID}.`);
    expect(() => parse("--synthetic-config", "s.json")).toThrow();
    expect(() => parse("--target", "repo", "--local-subject-config", "c.json", "--synthetic-config", "s.json")).toThrow();
    expect(() => parse("--target", "repo", "--local-subject-config", "a.json", "--local-subject-config", "b.json")).toThrow(/may be supplied only once/);
  });

  it("limits --local-subject-config to the three plugins that support it", () => {
    for (const experiment of ["warm-index-reuse", "incremental-change-staleness", "context-strategy-comparison"]) {
      expect(() => parseRunExperimentArgs(["--experiment", experiment, "--local-subject-config", "c.json"])).toThrow(
        "--local-subject-config is only supported for --experiment context-window-scaling, retrieval-precision-recall, retrieval-query-strategy-comparison, or context-pack-generation."
      );
    }
  });
});

describe("public external-local run: success", () => {
  it("TST-B4-019/031/032 completes, leaves the target unchanged, and writes exactly the approved durable family", async () => {
    const treeBefore = listTree(fixture.root);
    const statusBefore = git(fixture.root, "status", "--porcelain=v1", "--ignored");
    const output = capture();
    const code = await runExperimentRunCommandFromArgs(runArgs(), { context: context() });
    expect(output.stderr()).toBe("");
    expect(code).toBe(0);
    expect(output.stdout()).toContain("Status: completed");
    expect(output.stdout()).toContain("Mode: external-local repository subject");
    expect(output.stdout()).toContain("Subject: rpr-subject");

    expect(listTree(fixture.root)).toEqual(treeBefore);
    expect(git(fixture.root, "status", "--porcelain=v1", "--ignored")).toBe(statusBefore);
    for (const forbidden of [".my-dev-kit", ".my-dev-kit-lab", "lab-output", "lab-out"]) expect(existsSync(path.join(fixture.root, forbidden))).toBe(false);

    // Exactly the five-file family, no directories: no commands/, indexes/, s-* scratch or raw command files.
    expect(walkFiles(outDir)).toEqual(DURABLE_FAMILY);
    expect(readdirSync(outDir).some((entry) => /^s-/.test(entry))).toBe(false);
    expect(readdirSync(outDir, { withFileTypes: true }).every((entry) => entry.isFile())).toBe(true);
  });

  it("builds one private index per configured case with that case's exact roots and the safe exclusions", async () => {
    capture();
    expect(await runExperimentRunCommandFromArgs(runArgs(), { context: context() })).toBe(0);
    const calls = readKitLog(logPath);
    const indexCalls = calls.filter((entry) => entry.argv[0] === "index");
    expect(indexCalls).toHaveLength(2);
    expect(indexCalls.map((entry) => entry.argv.flatMap((value, index) => (value === "--src" ? [entry.argv[index + 1]] : [])))).toEqual([["src"], ["src/util"]]);
    for (const call of indexCalls) {
      expect(call.argv[call.argv.indexOf("--root") + 1]).toBe(fixture.subject.repositoryRoot);
      const excluded = call.argv.flatMap((value, index) => (value === "--exclude" ? [call.argv[index + 1]] : []));
      expect(excluded).toEqual(expect.arrayContaining(["src/gen", "src/huge.ts", "src/ignored.ts"]));
      const indexOut = call.argv[call.argv.indexOf("--out") + 1];
      expect(path.relative(outDir, indexOut).startsWith("..")).toBe(false);
      expect(path.relative(outDir, indexOut).split(path.sep)[0]).toMatch(/^s-/);
    }
    expect(calls.filter((entry) => entry.argv[0] === "search")).toHaveLength(2);
  });

  it("TST-B4-033/039 keeps the exact scientific numbers while withholding every private identity", async () => {
    capture();
    expect(await runExperimentRunCommandFromArgs(runArgs(), { context: context() })).toBe(0);
    const artifact = JSON.parse(readFileSync(path.join(outDir, "retrieval-precision-recall-execution.json"), "utf8"));
    expect(artifact.schemaVersion).toBe("my-dev-kit-lab-retrieval-precision-recall-execution-v1");
    expect(checkRetrievalRedactionTruthfulness(artifact)).toEqual([]);

    const [one, two] = artifact.cases;
    expect([one.caseId, one.benchmarkProject, one.caseName, one.status]).toEqual(["rpr-case-one", "rpr-subject", "<redacted case title>", "completed"]);
    // case one: retrieved {main, helper} vs expected {main, helper}; symbols {Alpha} vs {Alpha, Beta}; fact one covered, fact two not.
    expect(one.quality.file.precision).toMatchObject({ availability: "available", numerator: 2, denominator: 2, value: 1 });
    expect(one.quality.file.recall).toMatchObject({ numerator: 2, denominator: 2, value: 1 });
    expect(one.quality.symbol.precision).toMatchObject({ numerator: 1, denominator: 1, value: 1 });
    expect(one.quality.symbol.recall).toMatchObject({ numerator: 1, denominator: 2, value: 0.5 });
    expect(one.quality.fact.coverage).toMatchObject({ numerator: 1, denominator: 2, value: 0.5 });
    expect(one.quality.fact.uncoveredFactIds).toEqual(["<redacted fact 1>"]);
    expect(one.quality.file.missedFileCount).toBe(0);
    expect(one.quality.file.missedFiles).toEqual([]);
    // case two: expected {helper}; the kit still surfaces main too, which is irrelevant noise for this case.
    expect(two.quality.file.precision).toMatchObject({ numerator: 1, denominator: 2, value: 0.5 });
    expect(two.quality.irrelevantContextRatio).toMatchObject({ numerator: 1, denominator: 2, value: 0.5 });
    expect(two.quality.file.irrelevantRetrievedFiles).toEqual(["<redacted file 1>"]);
    expect(two.quality.symbol.recall).toMatchObject({ numerator: 0, denominator: 1, value: 0 });
    expect(artifact.aggregate.runSummary).toMatchObject({ projectCount: 1, caseCount: 2, completedCaseCount: 2, failedCaseCount: 0 });
    expect(artifact.aggregate.ratios.filePrecision.meanValue).toBe(0.75);
    expect(artifact.aggregate.occurrences.totalIrrelevantRetrievedFileOccurrences).toBe(1);
  });

  it("TST-B4-034/035/036/037 keeps every durable file free of private identities, paths and markers", async () => {
    capture();
    expect(await runExperimentRunCommandFromArgs(runArgs(), { context: context() })).toBe(0);
    const leaks = scanDurableOutputDirectory(outDir, privateSentinels());
    expect(leaks, JSON.stringify(leaks)).toEqual([]);
    for (const file of DURABLE_FAMILY) {
      const text = readFileSync(path.join(outDir, file), "utf8");
      expect(text, file).not.toMatch(/"(contextText|stdout|stderr|commandString)"\s*:/);
    }
  });

  it("TST-B4-037 writes the existing manifest through its serializer with no physical path or private file list", async () => {
    capture();
    expect(await runExperimentRunCommandFromArgs(runArgs(), { context: context() })).toBe(0);
    const written = readFileSync(path.join(outDir, "local-repository-subject-manifest.json"), "utf8");
    const reloaded = await loadLocalRepositorySubject({ config: JSON.parse(readFileSync(configPath, "utf8")), repositoryPath: fixture.root });
    expect(written).toBe(serializeLocalRepositorySubjectManifest(reloaded.manifest));
    const manifest = JSON.parse(written) as Record<string, unknown>;
    expect(manifest.schemaId).toBe("my-dev-kit-lab-local-repository-subject-manifest-v1");
    expect(Object.keys(manifest)).toEqual(["schemaId", "schemaVersion", "subjectId", "logicalTargetRoot", "repository", "safetyPolicy", "sourceRoots", "caseCount", "caseIds", "inventory"]);
    expect(manifest.logicalTargetRoot).toBe("local-repository:rpr-subject");
  });

  it("projects the durable target and metadata and exposes the redaction marker in report.json", async () => {
    capture();
    expect(await runExperimentRunCommandFromArgs(runArgs(), { context: context() })).toBe(0);
    const parsed = JSON.parse(readFileSync(path.join(outDir, "report.json"), "utf8")) as { report: any; outputPaths: Record<string, string> };
    expect(parsed.report.plugin).toMatchObject({ id: ID, supportedTargets: ["self", "external-local"] });
    expect(parsed.report.target).toMatchObject({
      kind: "external-local",
      isSelf: false,
      targetRoot: "local-repository:rpr-subject",
      toolRoot: "[redacted]",
      packageName: null,
      packageVersion: null,
      hasGit: true,
      privacyProjection: "external-local-redacted",
      branch: "main",
      commit: fixture.subject.manifest.repository.commit
    });
    expect(parsed.report.metadata.outputRoot).toBe("[redacted]");
    expect(parsed.outputPaths).toEqual({ outDir: "[redacted]", jsonPath: "report.json", htmlPath: "report.html", textPath: "report.txt" });
    expect(parsed.report.rawRun.metadata.executionArtifactPath).toBe("retrieval-precision-recall-execution.json");
    expect(parsed.report.rawRun.metadata.outputRoot).toBe("[redacted]");
    expect(parsed.report.artifacts.map((artifact: { id: string }) => artifact.id)).toEqual(["retrieval-precision-recall-execution", "local-repository-subject-manifest"]);
    const section = parsed.report.retrievalPrecisionRecall;
    expect(section.cases.map((entry: { caseId: string }) => entry.caseId)).toEqual(["rpr-case-one", "rpr-case-two"]);
    for (const entry of section.cases) {
      expect(entry.identityRedaction).toEqual({ fileIdentities: "redacted", symbolIdentities: "redacted", factIdentities: "redacted", warningText: "redacted", caseTitle: "redacted" });
    }
    expect(section.cases[1].irrelevantRetrievedFiles).toEqual({ totalCount: 1, displayed: ["<redacted file 1>"], displayedCount: 1, omittedCount: 0 });
    expect(section.cases[0].missedFiles.totalCount).toBe(0);
  });

  it("TST-B4-036/064 states the redaction in text and HTML, and escapes the placeholder angle brackets", async () => {
    capture();
    expect(await runExperimentRunCommandFromArgs(runArgs(), { context: context() })).toBe(0);
    const text = readFileSync(path.join(outDir, "report.txt"), "utf8");
    const html = readFileSync(path.join(outDir, "report.html"), "utf8");
    expect(text).toContain("Identity Redaction: External-local run");
    expect(text).toContain("<redacted file 1>");
    expect(text).toContain("  Identity redaction: files, symbols, facts, warnings and case title withheld");
    expect(html).toContain("&lt;redacted file 1&gt;");
    expect(html).not.toContain("<redacted file 1>");
    expect(html).not.toMatch(/<redacted [a-z]+ \d+>/);
    expect(html).toContain("Identity redaction.");
    for (const surface of [text, html]) expect(surface).toContain("&lt;redacted case title&gt;".replace(/&lt;|&gt;/g, (m) => (surface === text ? (m === "&lt;" ? "<" : ">") : m)));
  });

  it("TST-B4-014 completes as a partial run, not a failure, when the real command output is only partly interpretable", async () => {
    process.env.RPR_KIT_FAIL = "lookup";
    const output = capture();
    const code = await runExperimentRunCommandFromArgs(runArgs(), { context: context() });
    expect(code, output.stderr()).toBe(0);
    expect(output.stdout()).toContain("Status: partial");
    expect(walkFiles(outDir)).toEqual(DURABLE_FAMILY);
    const artifact = JSON.parse(readFileSync(path.join(outDir, "retrieval-precision-recall-execution.json"), "utf8"));
    expect(artifact.cases.map((entry: { status: string }) => entry.status)).toEqual(["partial", "partial"]);
    expect(artifact.cases[0].quality.file.precision).toMatchObject({ availability: "unavailable", reason: "retrieval-evidence-partial" });
    // The raw stderr and the retrieval warning prose are never persisted, only a placeholder count.
    expect(artifact.cases[0].retrieval.warnings).toEqual(["<redacted warning 1>"]);
    expect(scanDurableOutputDirectory(outDir, privateSentinels())).toEqual([]);
    expect(checkRetrievalRedactionTruthfulness(artifact)).toEqual([]);
  });

  it("TST-B4-020 succeeds against a repository with pre-existing uncommitted work and does not clean it", async () => {
    writeFileSync(path.join(fixture.root, "src", "util", "helper.ts"), "export const helper = 2; // uncommitted user edit\n");
    const statusBefore = git(fixture.root, "status", "--porcelain=v1");
    capture();
    expect(await runExperimentRunCommandFromArgs(runArgs(), { context: context() })).toBe(0);
    expect(git(fixture.root, "status", "--porcelain=v1")).toBe(statusBefore);
    expect(readFileSync(path.join(fixture.root, "src", "util", "helper.ts"), "utf8")).toContain("uncommitted user edit");
    const manifest = JSON.parse(readFileSync(path.join(outDir, "local-repository-subject-manifest.json"), "utf8"));
    expect(manifest.repository.workingTreeDirty).toBe(true);
    expect(walkFiles(outDir)).toEqual(DURABLE_FAMILY);
  });

  it("TST-B4-047 never treats the symlink as eligible subject material and never persists its name", async () => {
    if (!fixture.symlinkCreated) return;
    expect(fixture.subject.eligibleFiles).not.toContain("src/linked.ts");
    capture();
    expect(await runExperimentRunCommandFromArgs(runArgs(), { context: context() })).toBe(0);
    expect(scanDurableOutputDirectory(outDir, [{ label: "symlink", value: "linked.ts", kind: "text" }, { label: "symlink target", value: "SYMLINK_TARGET_MARKER_c0de", kind: "text" }])).toEqual([]);
    process.env.RPR_KIT_FILES = "src/linked.ts";
    const second = path.join(path.dirname(outDir), "second");
    const output = capture();
    expect(await runExperimentRunCommandFromArgs(runArgs(["--out", second]), { context: context() })).toBe(1);
    expect(output.stdout()).toContain("RETRIEVAL_OUTSIDE_ELIGIBLE_UNIVERSE");
    expect(output.stdout()).not.toContain("linked");
    expect(existsSync(second) ? readdirSync(second) : []).toEqual([]);
  });
});

describe("public external-local run: failure atomicity and privacy", () => {
  async function failureRun(extra: string[] = []): Promise<{ code: number; stdout: string; stderr: string }> {
    const output = capture();
    const code = await runExperimentRunCommandFromArgs(runArgs(extra), { context: context() });
    return { code, stdout: output.stdout(), stderr: output.stderr() };
  }

  function expectSafeConsole(result: { stdout: string; stderr: string }, forbidden: string[] = []): void {
    const everything = `${result.stdout}\n${result.stderr}`;
    for (const value of [...privateSentinels().map((sentinel) => sentinel.value).filter((value) => value !== "main.ts"), ...forbidden]) {
      expect(everything.includes(value), `console contains ${value}`).toBe(false);
    }
  }

  const expectNoDurableFamily = (): void => {
    const files = existsSync(outDir) ? walkFiles(outDir) : [];
    expect(files).toEqual([]);
  };

  it("TST-B4-016/038 fails closed on a retrieved file outside the eligible universe without naming it or writing any normal file", async () => {
    process.env.RPR_KIT_FILES = "src/ignored.ts";
    const result = await failureRun();
    expect(result.code).toBe(1);
    expect(result.stdout).toContain("Experiment: retrieval-precision-recall");
    expect(result.stdout).toContain("Status: failed");
    expect(result.stdout).toContain("Mode: external-local repository subject");
    expect(result.stdout).toContain("Subject: rpr-subject");
    expect(result.stdout).toContain("Failure: Local subject execution failed (RETRIEVAL_OUTSIDE_ELIGIBLE_UNIVERSE): case rpr-case-one: retrieval exposed 1 file identity outside the eligible subject universe.");
    expectSafeConsole(result);
    expect(result.stdout).not.toContain("Report JSON");
    expectNoDurableFamily();
    expect(readKitLog(logPath).filter((entry) => entry.argv[0] === "index")).toHaveLength(1);
  });

  it("TST-B4-021 detects a mutation made during the run, does not restore it, and writes no normal file", async () => {
    const mainPath = path.join(fixture.root, "src", "main.ts");
    process.env.RPR_KIT_MUTATE_FILE = mainPath;
    const result = await failureRun();
    expect(result.code).toBe(1);
    expect(result.stdout).toContain("Local subject execution failed (TARGET_MUTATED)");
    expect(result.stdout).toContain("the target changed during execution (");
    expect(result.stdout).toContain("it was not restored");
    expect(readFileSync(mainPath, "utf8")).toContain("// mutated by the kit");
    expectSafeConsole(result);
    expectNoDurableFamily();
  });

  it("fails on a my-dev-kit index failure without exposing raw kit output and writes no normal file", async () => {
    process.env.RPR_KIT_INDEX_FAIL = "1";
    const result = await failureRun();
    expect(result.code).toBe(1);
    expect(result.stdout).toContain("Local subject execution failed (EXECUTION_FAILED): case rpr-case-one: the my-dev-kit index could not be prepared.");
    expectSafeConsole(result, [RPR_MARKERS.stderr]);
    expectNoDurableFamily();
  });

  it("rejects incomplete external ground truth before any output or index, naming only case ids and counts", async () => {
    const broken = rprLocalSubjectCases();
    delete (broken[0].answerKey as { expectedContextTargets?: unknown }).expectedContextTargets;
    writeConfig(configPath, broken);
    const result = await failureRun();
    expect(result.code).toBe(1);
    expect(result.stderr).toBe("Invalid retrieval-precision-recall ground truth for the local subject (case rpr-case-one: 1 issue); details withheld.");
    expectSafeConsole(result);
    expect(existsSync(outDir)).toBe(false);
    expect(readKitLog(logPath)).toEqual([]);
  });

  it("TST-B4-018 rejects an output directory inside, or equal to, the target before creating anything", async () => {
    const treeBefore = listTree(fixture.root);
    for (const inside of [path.join(fixture.root, "lab-out"), fixture.root, path.join(fixture.root, "src", "nested", "out")]) {
      const result = await failureRun(["--out", inside]);
      expect(result.code).toBe(1);
      expect(result.stderr).toContain("Experiment output root must not be inside the external target project");
      expectSafeConsole(result);
      expect(listTree(fixture.root)).toEqual(treeBefore);
    }
    expect(readKitLog(logPath)).toEqual([]);
  });

  it("TST-B4-043 rejects an output path that only resolves inside the target through a physical alias", async () => {
    const aliasParent = makeTempDir("rpr-alias-");
    dirs.push(aliasParent);
    const alias = path.join(aliasParent, "alias");
    const created = tryCreateSymlink(fixture.root, alias, "dir");
    if (!created.ok) {
      console.warn(`physical alias test skipped: ${created.reason}`);
      return;
    }
    const treeBefore = listTree(fixture.root);
    const result = await failureRun(["--out", path.join(alias, "run")]);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("Experiment output root must not be inside the external target project");
    expect(listTree(fixture.root)).toEqual(treeBefore);
    expect(readKitLog(logPath)).toEqual([]);
  });

  it("rejects a self target, a non-Git target and a malformed config before creating output", async () => {
    const self = await failureRun(["--target", process.cwd()]);
    expect(self.code).toBe(1);
    expect(existsSync(outDir)).toBe(false);
    const plain = makeTempDir("rpr-plain-");
    dirs.push(plain);
    const nonGit = await failureRun(["--target", plain]);
    expect(nonGit.code).toBe(1);
    expect(nonGit.stderr).toContain("NOT_A_GIT_REPOSITORY");
    writeFileSync(configPath, "{ not json");
    const malformed = await failureRun();
    expect(malformed.code).toBe(1);
    expect(malformed.stderr).toContain("is not valid JSON");
    expect(existsSync(outDir)).toBe(false);
  });
});

describe("path hardening for external-local retrieval-precision-recall", () => {
  /** Runs a fresh repository + config + output at the given (possibly awkward) locations. */
  async function runAt(options: { targetParent: string; configDir: string; outParent: string }): Promise<{
    code: number;
    out: string;
    target: string;
    treeBefore: string[];
    output: ReturnType<typeof capture>;
    setupSkipped: string | null;
  }> {
    const target = path.join(options.targetParent, "target repo");
    let setupSkipped: string | null = null;
    try {
      mkdirSync(target, { recursive: true });
      initRepository(target);
      writeRepositoryFile(target, "src/main.ts", "export const value = 1;\n");
      writeRepositoryFile(target, "src/util/helper.ts", "export const helper = 2;\n");
      commitAll(target, "fixture");
    } catch (error) {
      setupSkipped = `repository could not be prepared at this path (${(error as NodeJS.ErrnoException).code ?? "platform limit"})`;
    }
    const config = path.join(options.configDir, "local subject.json");
    const out = path.join(options.outParent, "run");
    if (setupSkipped === null) writeConfig(config);
    const treeBefore = setupSkipped === null ? listTree(target) : [];
    const output = capture();
    const code = setupSkipped === null ? await runExperimentRunCommandFromArgs(["--experiment", ID, "--target", target, "--local-subject-config", config, "--kit-command", kitCommand, "--out", out], { context: context() }) : -1;
    return { code, out, target, treeBefore, output, setupSkipped };
  }

  function expectSuccessOrCleanFailure(result: Awaited<ReturnType<typeof runAt>>): void {
    if (result.setupSkipped !== null) {
      console.warn(`path hardening case skipped: ${result.setupSkipped}`);
      return;
    }
    expect(listTree(result.target)).toEqual(result.treeBefore);
    if (result.code === 0) {
      expect(walkFiles(result.out)).toEqual(DURABLE_FAMILY);
      expect(scanDurableOutputDirectory(result.out, [{ label: "target", value: result.target, kind: "path" }, { label: "out", value: result.out, kind: "path" }])).toEqual([]);
    } else {
      // A platform limit may stop the run, but only cleanly: bounded output, no normal durable family, target untouched.
      expect(result.code).toBe(1);
      expect(existsSync(result.out) ? walkFiles(result.out) : []).toEqual([]);
      expect(`${result.output.stdout()}\n${result.output.stderr()}`).not.toContain(result.target);
    }
  }

  it("TST-B4-040 handles spaces and non-ASCII characters in the target, config and output paths", async () => {
    const base = makeTempDir("rpr-unicode-");
    dirs.push(base);
    const result = await runAt({
      targetParent: path.join(base, "dossier cible ünï cødé"),
      configDir: path.join(base, "config ünï dir"),
      outParent: path.join(base, "sortie é ü", "out dir")
    });
    expectSuccessOrCleanFailure(result);
    if (result.setupSkipped === null) {
      expect(result.code, `${result.output.stdout()} ${result.output.stderr()}`).toBe(0);
    }
  });

  // "within-limit" stays under the classic Windows MAX_PATH so the run is genuinely exercised; "beyond-limit" exceeds it, where
  // the repository or the run may legitimately be unsupported by the platform (then only a clean, non-mutating failure is accepted).
  it.each([
    ["within-limit", 3, 100],
    ["beyond-limit", 8, 300]
  ])("TST-B4-041 handles a %s long target path with success or a clean, non-mutating, bounded failure", async (_label, segments, minimumLength) => {
    const base = makeTempDir("rpr-longtarget-");
    dirs.push(base);
    const longTargetParent = path.join(base, ...Array.from({ length: segments }, (_, index) => `long-target-seg-${index}-${"t".repeat(17)}`));
    const result = await runAt({ targetParent: longTargetParent, configDir: path.join(base, "cfg"), outParent: path.join(base, "out") });
    expect(longTargetParent.length).toBeGreaterThan(minimumLength);
    expectSuccessOrCleanFailure(result);
    if (_label === "within-limit" && result.setupSkipped === null) expect(result.code, `${result.output.stdout()} ${result.output.stderr()}`).toBe(0);
  });

  it.each([
    ["within-limit", 3, 100],
    ["beyond-limit", 8, 300]
  ])("TST-B4-042 handles a %s long output path with success or a clean, non-mutating, bounded failure", async (_label, segments, minimumLength) => {
    const base = makeTempDir("rpr-longout-");
    dirs.push(base);
    const longOut = path.join(base, ...Array.from({ length: segments }, (_, index) => `long-output-seg-${index}-${"o".repeat(17)}`));
    const result = await runAt({ targetParent: path.join(base, "tgt"), configDir: path.join(base, "cfg"), outParent: longOut });
    expect(longOut.length).toBeGreaterThan(minimumLength);
    expectSuccessOrCleanFailure(result);
    if (_label === "within-limit" && result.setupSkipped === null) expect(result.code, `${result.output.stdout()} ${result.output.stderr()}`).toBe(0);
  });
});
