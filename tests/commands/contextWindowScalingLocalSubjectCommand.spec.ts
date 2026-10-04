import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderExperimentRunHelp } from "../../src/cli/help.js";
import { runExperimentDescribeCommandFromArgs } from "../../src/commands/runExperimentDescribeCommand.js";
import { parseRunExperimentArgs, runExperimentRunCommandFromArgs } from "../../src/commands/runExperimentRunCommand.js";
import { loadLocalRepositorySubject, serializeLocalRepositorySubjectManifest } from "../../src/evaluation/localRepositorySubject/index.js";
import { createDefaultExperimentPluginRegistry, runExperiment } from "../../src/experiments/index.js";
import { createLabExecutionContext } from "../../src/runtime/index.js";
import { commitAll, initRepository, makeTempDir, minimalCase, minimalConfig, removeTempDir, writeRepositoryFile } from "../evaluation/localRepositorySubject/fixtureRepository.js";
import {
  MARKERS,
  createLocalSubjectFixture,
  git,
  listTree,
  readKitLog,
  writeRecordingFakeKit,
} from "../experiments/contextWindowScaling/localSubjectFixture.js";
import type { LocalSubjectFixture } from "../experiments/contextWindowScaling/localSubjectFixture.js";

vi.setConfig({ testTimeout: 180_000, hookTimeout: 180_000 });

const ID = "context-window-scaling";
const OVER_DEFAULT_LIMIT = 1_048_576 + 100;

let fixture: LocalSubjectFixture;
let scratchDirs: string[];
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
  scratchDirs = [];
  fixture = await createLocalSubjectFixture({ hugeFileBytes: OVER_DEFAULT_LIMIT });
  const kitDirectory = makeTempDir("lrs-b3-kit-");
  scratchDirs.push(kitDirectory);
  kitCommand = writeRecordingFakeKit(kitDirectory).command;
  logPath = path.join(kitDirectory, "log.jsonl");
  process.env.LRS_FAKE_KIT_LOG = logPath;
  const configDir = makeTempDir("lrs-b3-config-");
  scratchDirs.push(configDir);
  configPath = path.join(configDir, "local-subject.json");
  writeFileSync(configPath, JSON.stringify(minimalConfig({ cases: [minimalCase({ rawIncludeGlobs: ["src/**/*"], expectedFiles: ["src/main.ts"] })] })));
  const outParent = makeTempDir("lrs-b3-out-");
  scratchDirs.push(outParent);
  outDir = path.join(outParent, "run");
});

afterEach(() => {
  vi.restoreAllMocks();
  for (const variable of ["LRS_FAKE_KIT_LOG", "LRS_FAKE_KIT_FILE", "LRS_FAKE_KIT_MUTATE"]) delete process.env[variable];
  for (const directory of [...fixture.directories, ...scratchDirs]) removeTempDir(directory);
});

function runArgs(extra: string[] = []): string[] {
  return ["--experiment", ID, "--target", fixture.root, "--local-subject-config", configPath, "--context-budgets", "8k,16k", "--kit-command", kitCommand, "--out", outDir, ...extra];
}

function walkFiles(directory: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) found.push(...walkFiles(full));
    else found.push(full);
  }
  return found.sort();
}

// Includes the JSON-escaped form: serialized artifacts double every backslash of a Windows path.
const slashVariants = (value: string): string[] => {
  const variants = [value, value.replace(/\\/g, "/"), value.replace(/\//g, "\\")];
  return [...new Set([...variants, ...variants.map((entry) => JSON.stringify(entry).slice(1, -1))])];
};

describe("RSP subject-mode matrix: parsing and validation", () => {
  const parse = (...args: string[]) => parseRunExperimentArgs(["--experiment", ID, ...args]);

  it("accepts the external-local form and keeps the config path out of the plugin config", () => {
    const parsed = parse("--target", "repo", "--local-subject-config", "cfg.json", "--context-budgets", "8k", "--kit-command", "kit", "--out", "o");
    expect(parsed.targetPath).toBe("repo");
    expect(parsed.localSubjectConfigPath).toBe("cfg.json");
    expect(parsed.syntheticConfigPath).toBeUndefined();
    expect(parsed.config).toEqual({ contextBudgets: [8192], kitCommand: "kit" });
  });

  it("keeps bundled and synthetic selection exactly as before", () => {
    expect(parse("--out", "o", "--case", "a").localSubjectConfigPath).toBeUndefined();
    const synthetic = parse("--synthetic-config", "s.json", "--out", "o");
    expect(synthetic.syntheticConfigPath).toBe("s.json");
    expect(synthetic.targetPath).toBeUndefined();
  });

  it.each([
    [["--local-subject-config", "c.json"], /--local-subject-config requires an external --target for context-window-scaling/],
    [["--target", "r"], /External context-window-scaling targets require --local-subject-config/],
    [["--target", "r", "--synthetic-config", "s.json"], /--synthetic-config cannot be combined with --target/],
    [["--synthetic-config", "s.json", "--local-subject-config", "c.json"], /--synthetic-config and --local-subject-config are mutually exclusive/],
    [["--target", "r", "--local-subject-config", "c.json", "--synthetic-config", "s.json"], /mutually exclusive/],
    [["--target", "r", "--local-subject-config", "c.json", "--case", "a"], /--case cannot be combined with --local-subject-config/],
    [["--local-subject-config", "c.json", "--local-subject-config", "d.json", "--target", "r"], /may be supplied only once/],
  ])("rejects %j", (args, message) => {
    expect(() => parse(...args)).toThrow(message);
  });

  it("rejects the flag for every other experiment", () => {
    for (const experiment of ["warm-index-reuse", "incremental-change-staleness", "context-strategy-comparison"]) {
      expect(() => parseRunExperimentArgs(["--experiment", experiment, "--local-subject-config", "c.json"])).toThrow(
        /--local-subject-config is only supported for --experiment context-window-scaling/
      );
    }
  });

  it("still rejects unrelated flags and the legacy options for context-window-scaling", () => {
    expect(() => parse("--target", "r", "--local-subject-config", "c.json", "--agents", "fake-agent")).toThrow(/--agents is not supported/);
  });

  it("rejects a self target in local mode at run time without creating output", async () => {
    const output = capture();
    const toolOut = path.join(scratchDirs[0], "self-run");
    const code = await runExperimentRunCommandFromArgs(
      ["--experiment", ID, "--target", process.cwd(), "--local-subject-config", configPath, "--out", toolOut],
      { context: createLabExecutionContext({ invocationCwd: process.cwd() }) }
    );
    expect(code).toBe(1);
    expect(output.stderr()).toContain("requires an external-local target");
    expect(existsSync(toolOut)).toBe(false);
  });

  it("rejects a non-Git external target and a malformed config before creating output", async () => {
    const plain = makeTempDir("lrs-b3-plain-");
    scratchDirs.push(plain);
    let output = capture();
    expect(await runExperimentRunCommandFromArgs(runArgs().map((value) => (value === fixture.root ? plain : value)))).toBe(1);
    expect(output.stderr()).toContain("NOT_A_GIT_REPOSITORY");
    expect(existsSync(outDir)).toBe(false);
    vi.restoreAllMocks();

    writeFileSync(configPath, "{ not json");
    output = capture();
    expect(await runExperimentRunCommandFromArgs(runArgs())).toBe(1);
    expect(output.stderr()).toContain("is not valid JSON");
    expect(existsSync(outDir)).toBe(false);
    vi.restoreAllMocks();

    writeFileSync(configPath, JSON.stringify({ schemaVersion: "9", subjectId: "", cases: [] }));
    output = capture();
    expect(await runExperimentRunCommandFromArgs(runArgs())).toBe(1);
    expect(output.stderr()).toContain("Invalid local repository subject configuration");
    expect(existsSync(outDir)).toBe(false);
  });
});

describe("public help and describe", () => {
  it("documents the flag and the three subject modes without claiming quality measurement", async () => {
    const help = renderExperimentRunHelp();
    expect(help).toContain("--local-subject-config <path>");
    expect(help).toContain("LocalRepositorySubjectConfigV1");
    expect(help).toMatch(/not retrieval precision, recall, or ranking quality/);
    const output = capture();
    expect(await runExperimentDescribeCommandFromArgs(["--experiment", ID])).toBe(0);
    const described = output.stdout();
    expect(described).toContain("Supported targets: self, external-local");
    expect(described).toContain("--local-subject-config");
    expect(described).toContain("--target <local-git-repository> --local-subject-config");
    expect(described).not.toMatch(/--target "Z:/);
  });
});

describe("public external-local run", () => {
  it("runs through the safe seam, leaves the target unchanged, and writes only privacy-safe output outside it", async () => {
    const treeBefore = listTree(fixture.root);
    const statusBefore = git(fixture.root, "status", "--porcelain=v1");
    const output = capture();
    const code = await runExperimentRunCommandFromArgs(runArgs(), { context: createLabExecutionContext({ invocationCwd: process.cwd() }) });
    expect(output.stderr()).toBe("");
    expect(code).toBe(0);

    const stdout = output.stdout();
    expect(stdout).toContain("Status: completed");
    expect(stdout).toContain("Mode: external-local repository subject");
    expect(stdout).toContain("Subject: fixture-subject");
    for (const variant of slashVariants(fixture.root)) expect(stdout).not.toContain(variant);

    expect(listTree(fixture.root)).toEqual(treeBefore);
    expect(git(fixture.root, "status", "--porcelain=v1")).toBe(statusBefore);
    expect(path.relative(fixture.root, outDir).startsWith("..")).toBe(true);

    const files = walkFiles(outDir).map((file) => path.relative(outDir, file).replace(/\\/g, "/"));
    expect(files).toEqual([
      "context-window-scaling-execution.json",
      "local-repository-subject-manifest.json",
      "report.html",
      "report.json",
      "report.txt",
    ]);
    expect(readdirSync(outDir).some((entry) => /^s-/.test(entry))).toBe(false);
    for (const forbidden of [".my-dev-kit", ".my-dev-kit-lab", "lab-output"]) expect(existsSync(path.join(fixture.root, forbidden))).toBe(false);
    const indexCommands = readKitLog(logPath).filter((entry) => entry.argv[0] === "index");
    expect(indexCommands.length).toBeGreaterThan(0);
    for (const command of indexCommands) expect(command.argv[command.argv.indexOf("--root") + 1]).toBe(fixture.subject.repositoryRoot);
  });

  it("writes the Batch 1 manifest through its serializer", async () => {
    capture();
    expect(await runExperimentRunCommandFromArgs(runArgs())).toBe(0);
    const written = readFileSync(path.join(outDir, "local-repository-subject-manifest.json"), "utf8");
    const reloaded = await loadLocalRepositorySubject({ config: JSON.parse(readFileSync(configPath, "utf8")), repositoryPath: fixture.root });
    expect(written).toBe(serializeLocalRepositorySubjectManifest(reloaded.manifest));
    const manifest = JSON.parse(written) as Record<string, unknown>;
    expect(manifest.schemaId).toBe("my-dev-kit-lab-local-repository-subject-manifest-v1");
    expect(manifest.schemaVersion).toBe("1.0.0");
    expect(Object.keys(manifest)).toEqual([
      "schemaId", "schemaVersion", "subjectId", "logicalTargetRoot", "repository", "safetyPolicy", "sourceRoots", "caseCount", "caseIds", "inventory",
    ]);
  });

  it("keeps every durable artifact free of machine paths, source text and exact file names", async () => {
    capture();
    expect(await runExperimentRunCommandFromArgs(runArgs())).toBe(0);
    const forbidden = [
      ...slashVariants(fixture.root),
      ...slashVariants(path.dirname(fixture.root)),
      ...slashVariants(fixture.workRoot),
      ...slashVariants(path.dirname(outDir)),
      ...slashVariants(process.cwd()),
      os.homedir(),
      os.tmpdir(),
      ...Object.values(MARKERS),
      "ignored.ts",
      "huge.ts",
      "linked.ts",
      "gen/out",
      "src/main.ts",
      "helper.ts",
      "indexes",
      "fake-kit",
    ];
    for (const file of walkFiles(outDir)) {
      const text = readFileSync(file, "utf8");
      for (const value of forbidden) expect(text.includes(value), `${path.basename(file)} contains ${value}`).toBe(false);
    }
  });

  it("marks redacted file identities explicitly and keeps counts truthful", async () => {
    capture();
    expect(await runExperimentRunCommandFromArgs(runArgs())).toBe(0);
    const artifact = JSON.parse(readFileSync(path.join(outDir, "context-window-scaling-execution.json"), "utf8")) as {
      cases: { targetRoot: string; benchmarkProject: string; treatments: Record<string, any>[] }[];
    };
    expect(artifact.cases[0].targetRoot).toBe("local-repository:fixture-subject");
    expect(artifact.cases[0].benchmarkProject).toBe("fixture-subject");
    for (const treatment of artifact.cases[0].treatments) {
      expect(treatment.fileIdentityRedaction).toBe("redacted");
      const relevant = treatment.relevantFileEvidence;
      expect(relevant.expectedRelevantFiles).toHaveLength(relevant.expectedRelevantFileCount);
      expect(relevant.omittedRelevantFiles).toHaveLength(relevant.omittedRelevantFileCount ?? 0);
      for (const entry of [...(treatment.context.observedFiles ?? []), ...relevant.expectedRelevantFiles, ...relevant.omittedRelevantFiles]) {
        expect(entry).toMatch(/^<redacted file \d+>$/);
      }
    }
    const raw = artifact.cases[0].treatments.find((treatment) => treatment.variantId === "raw-full-file");
    // Two eligible files (main.ts, helper.ts) were read: two placeholders, never an empty list.
    expect(raw?.context.observedFiles).toEqual(["<redacted file 1>", "<redacted file 2>"]);
    const report = JSON.parse(readFileSync(path.join(outDir, "report.json"), "utf8")) as { report: { target: Record<string, unknown>; metadata: Record<string, unknown> }; outputPaths: Record<string, string> };
    expect(report.report.target).toMatchObject({
      kind: "external-local",
      isSelf: false,
      targetRoot: "local-repository:fixture-subject",
      toolRoot: "[redacted]",
      privacyProjection: "external-local-redacted",
      commit: fixture.subject.manifest.repository.commit,
      branch: "main",
    });
    expect(report.report.metadata.outputRoot).toBe("[redacted]");
    expect(report.outputPaths).toEqual({ outDir: "[redacted]", jsonPath: "report.json", htmlPath: "report.html", textPath: "report.txt" });
  });

  it("matches the scientific shape of the existing context-window evidence", async () => {
    capture();
    expect(await runExperimentRunCommandFromArgs(runArgs())).toBe(0);
    const artifact = JSON.parse(readFileSync(path.join(outDir, "context-window-scaling-execution.json"), "utf8")) as {
      schemaVersion: string;
      contextBudgets: number[];
      estimator: { tokenCountMethod: string };
      cases: { treatments: { variantId: string; budgetCells: unknown[] }[] }[];
    };
    expect(artifact.contextBudgets).toEqual([8192, 16384]);
    expect(artifact.cases[0].treatments.map((treatment) => treatment.variantId)).toEqual(["raw-full-file", "my-dev-kit-guided"]);
    for (const treatment of artifact.cases[0].treatments) expect(treatment.budgetCells).toHaveLength(2);
    expect(artifact.estimator.tokenCountMethod.length).toBeGreaterThan(0);
  });
});

describe("output containment", () => {
  it("rejects an output directory inside the target before creating anything", async () => {
    const inside = path.join(fixture.root, "lab-out");
    const treeBefore = listTree(fixture.root);
    const output = capture();
    const code = await runExperimentRunCommandFromArgs(runArgs(["--out", inside]));
    expect(code).toBe(1);
    expect(output.stderr()).toContain("Experiment output root must not be inside the external target project");
    for (const variant of slashVariants(fixture.root)) expect(output.stderr()).not.toContain(variant);
    expect(existsSync(inside)).toBe(false);
    expect(listTree(fixture.root)).toEqual(treeBefore);
    expect(readKitLog(logPath)).toEqual([]);
  });

  it("rejects an output directory equal to the target", async () => {
    capture();
    expect(await runExperimentRunCommandFromArgs(runArgs(["--out", fixture.root]))).toBe(1);
    expect(readKitLog(logPath)).toEqual([]);
  });
});

describe("failure privacy through the public command", () => {
  it("fails on an excluded file returned by retrieval without leaking paths, names or comparison data", async () => {
    process.env.LRS_FAKE_KIT_FILE = "src/ignored.ts";
    const output = capture();
    const code = await runExperimentRunCommandFromArgs(runArgs());
    expect(code, output.stderr()).toBe(1);
    const stdout = output.stdout();
    expect(stdout, output.stderr()).toContain("Status: failed");
    expect(stdout).toContain("Failure: Local subject execution failed (EXECUTION_FAILED)");
    expect(stdout).toContain("my-dev-kit-guided");
    for (const text of [stdout, output.stderr()]) {
      for (const variant of slashVariants(fixture.root)) expect(text).not.toContain(variant);
      expect(text).not.toContain("ignored.ts");
    }
    // No report, artifact or manifest exists for a failed local run, and the private scratch is gone.
    expect(existsSync(outDir) ? walkFiles(outDir) : []).toEqual([]);
    expect(existsSync(outDir) ? readdirSync(outDir) : []).toEqual([]);
  });

  it("reports a target mutation by kind only, keeps the mutation, and cleans the scratch", async () => {
    const mutated = path.join(fixture.root, "src", "created-by-kit.ts");
    process.env.LRS_FAKE_KIT_MUTATE = mutated;
    const output = capture();
    const code = await runExperimentRunCommandFromArgs(runArgs());
    expect(code).toBe(1);
    expect(output.stdout()).toContain("TARGET_MUTATED");
    expect(output.stdout()).toContain("git-untracked-file");
    expect(output.stdout()).not.toContain("created-by-kit");
    expect(existsSync(mutated)).toBe(true);
    for (const variant of slashVariants(fixture.root)) expect(output.stdout()).not.toContain(variant);
    expect(existsSync(outDir) ? readdirSync(outDir) : []).toEqual([]);
  });
});

describe("target identity and plugin guards", () => {
  it("refuses a loaded subject that was loaded from a different repository than --target", async () => {
    const other = makeTempDir("lrs-b3-other-");
    scratchDirs.push(other);
    initRepository(other);
    writeRepositoryFile(other, "src/main.ts");
    commitAll(other);
    const run = await runExperiment({
      pluginId: ID,
      registry: createDefaultExperimentPluginRegistry(),
      targetPath: other,
      outputRoot: outDir,
      toolRoot: process.cwd(),
      config: { contextBudgets: [8192], kitCommand },
      inputs: { cases: fixture.subject.evaluationCases, localSubject: fixture.subject },
    });
    expect(run.status).toBe("failed");
    expect(run.failures[0].message).toContain("not the repository the local subject was loaded from");
    expect(readKitLog(logPath)).toEqual([]);
  });

  it("never runs the legacy path against an external-local target without a loaded subject", async () => {
    const run = await runExperiment({
      pluginId: ID,
      registry: createDefaultExperimentPluginRegistry(),
      targetPath: fixture.root,
      outputRoot: outDir,
      toolRoot: process.cwd(),
      config: { contextBudgets: [8192], kitCommand },
      inputs: { cases: fixture.subject.evaluationCases },
    });
    expect(run.status).toBe("failed");
    expect(run.failures[0].message).toContain("require a loaded local repository subject");
    expect(readKitLog(logPath)).toEqual([]);
  });

  it("passes the selected --target as the physical root the loader validates", async () => {
    const nested = path.join(fixture.root, "src");
    const output = capture();
    const code = await runExperimentRunCommandFromArgs(runArgs().map((value) => (value === fixture.root ? nested : value)));
    expect(code).toBe(1);
    expect(output.stderr()).toContain("NOT_WORKTREE_ROOT");
    expect(existsSync(outDir)).toBe(false);
  });
});
