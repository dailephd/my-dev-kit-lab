import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runExperimentRunCommandFromArgs } from "../../src/commands/runExperimentRunCommand.js";
import { parseContextWindowScalingExecutionArtifact } from "../../src/experiments/plugins/contextWindowScaling/index.js";
import { redactKnownPaths } from "../../src/experiments/plugins/contextWindowScaling/localSubjectPrivacy.js";
import { buildContextWindowScalingPlotData, readContextWindowScalingPlotSource } from "../../src/plots/buildContextWindowScalingPlotData.js";
import {
  checkRedactionTruthfulness,
  listDurableFiles,
  privacyForms,
  scanDurableArtifactText,
  scanDurableOutputDirectory,
} from "../../scripts/externalLocalPrivacyScan.js";
import type { PrivacySentinel } from "../../scripts/externalLocalPrivacyScan.js";
import { git as gitFixture, makeTempDir, minimalCase, minimalConfig, removeTempDir } from "../evaluation/localRepositorySubject/fixtureRepository.js";
import { MARKERS, listTree, writeRecordingFakeKit } from "../experiments/contextWindowScaling/localSubjectFixture.js";

vi.setConfig({ testTimeout: 180_000, hookTimeout: 180_000 });

const ID = "context-window-scaling";
const OVER_DEFAULT_LIMIT = 1_048_576 + 100;
const EXPECTED_FILES = ["src/main.ts", "src/util/helper.ts"];
const HTML_MARKER = "<b>&\"'HTML_MARKER_9e1</b>";
const DURABLE_FILES = [
  "context-window-scaling-execution.json",
  "local-repository-subject-manifest.json",
  "report.html",
  "report.json",
  "report.txt",
];

let scratch: string[];
let kitCommand: string;

/** Records path-length evidence; LRS_B4_EVIDENCE names an optional file because vitest may swallow console output. */
function evidence(line: string): void {
  if (process.env.LRS_B4_EVIDENCE) appendFileSync(process.env.LRS_B4_EVIDENCE, `${line}\n`);
  else console.info(line);
}

function capture() {
  const out: string[] = [];
  const err: string[] = [];
  vi.spyOn(console, "log").mockImplementation((...a) => void out.push(a.join(" ")));
  vi.spyOn(console, "error").mockImplementation((...a) => void err.push(a.join(" ")));
  return { stdout: () => out.join("\n"), stderr: () => err.join("\n") };
}

beforeEach(() => {
  scratch = [];
  const kitDirectory = makeTempDir("lrs-b4-kit-");
  scratch.push(kitDirectory);
  kitCommand = writeRecordingFakeKit(kitDirectory).command;
  process.env.LRS_FAKE_KIT_LOG = path.join(kitDirectory, "log.jsonl");
});

afterEach(() => {
  vi.restoreAllMocks();
  for (const variable of ["LRS_FAKE_KIT_LOG", "LRS_FAKE_KIT_FILE", "LRS_FAKE_KIT_MUTATE"]) delete process.env[variable];
  for (const directory of scratch) removeTempDir(directory);
});

function git(cwd: string, ...args: string[]): string {
  // core.longpaths lets the FIXTURE's own Git calls work on Windows beyond 260 characters; the product's calls are unchanged.
  return gitFixture(cwd, "-c", "core.longpaths=true", ...args);
}

/** A target repository with eligible, ignored, oversized and HTML-sensitive content, built at an exact root. */
function buildTarget(root: string): void {
  mkdirSync(root, { recursive: true });
  git(root, "init", "-q", "-b", "main");
  const write = (relative: string, content: string): void => {
    const absolute = path.join(root, ...relative.split("/"));
    mkdirSync(path.dirname(absolute), { recursive: true });
    writeFileSync(absolute, content);
  };
  write(".gitignore", "src/ignored.ts\nsrc/gen/\n");
  write("src/main.ts", `export const value = 1; // ${MARKERS.eligible}\n`);
  write("src/util/helper.ts", "export const helper = 2;\n");
  write("src/html-marker.ts", `// ${HTML_MARKER}\nexport const html = 1;\n`);
  write("src/huge.ts", `// ${MARKERS.oversized}\n${"x".repeat(OVER_DEFAULT_LIMIT)}\n`);
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", "fixture");
  write("src/ignored.ts", `export const ignored = 1; // ${MARKERS.ignoredFile}\n`);
  write("src/gen/out.ts", `export const generated = 1; // ${MARKERS.ignoredDirectory}\n`);
}

function writeConfig(configPath: string): void {
  mkdirSync(path.dirname(configPath), { recursive: true });
  writeFileSync(configPath, JSON.stringify(minimalConfig({ cases: [minimalCase({ rawIncludeGlobs: ["src/**/*"], expectedFiles: EXPECTED_FILES })] })));
}

function sentinelsFor(parts: { target: string; configDir: string; outDir: string }): PrivacySentinel[] {
  const paths = [parts.target, path.dirname(parts.target), parts.configDir, parts.outDir, path.dirname(parts.outDir), process.cwd(), os.homedir(), os.tmpdir()];
  return [
    ...[...new Set(paths)].map((value) => ({ label: `path ${value.length}`, value, kind: "path" as const })),
    ...Object.entries(MARKERS).map(([label, value]) => ({ label: `marker ${label}`, value, kind: "text" as const })),
    { label: "html marker", value: HTML_MARKER, kind: "text" },
    ...["ignored.ts", "huge.ts", "html-marker.ts", "gen/out", "src/main.ts", "helper.ts"].map((value) => ({ label: `file ${value}`, value, kind: "text" as const })),
    ...["indexes", "fake-kit"].map((value) => ({ label: `private ${value}`, value, kind: "text" as const })),
  ];
}

function runArgs(target: string, configPath: string, outDir: string, extra: string[] = []): string[] {
  return ["--experiment", ID, "--target", target, "--local-subject-config", configPath, "--context-budgets", "8k,16k", "--kit-command", kitCommand, "--out", outDir, ...extra];
}

describe("external-local privacy scanner", () => {
  const windowsRoot = "C:\\Users\\someone\\Private Repo\\target";

  it("detects the JSON-escaped Windows path form that a raw scan misses", () => {
    const serialized = JSON.stringify({ toolRoot: windowsRoot });
    expect(serialized.includes(windowsRoot)).toBe(false);
    const leaks = scanDurableArtifactText([{ name: "report.json", text: serialized }], [{ label: "target", value: windowsRoot, kind: "path" }]);
    expect(leaks).toEqual([{ artifact: "report.json", label: "target", form: "json-escaped raw" }]);
  });

  it("detects separator, HTML-escaped and case-folded forms and leaking artifact names", () => {
    const sentinel: PrivacySentinel = { label: "target", value: windowsRoot, kind: "path" };
    expect(scanDurableArtifactText([{ name: "a", text: windowsRoot.replace(/\\/g, "/") }], [sentinel])).toHaveLength(1);
    expect(scanDurableArtifactText([{ name: "a", text: windowsRoot.toLowerCase() }], [sentinel])).toHaveLength(1);
    const marker: PrivacySentinel = { label: "marker", value: HTML_MARKER, kind: "text" };
    const html = scanDurableArtifactText([{ name: "a", text: "<td>&lt;b&gt;&amp;&quot;&#39;HTML_MARKER_9e1&lt;/b&gt;</td>" }], [marker]);
    expect(html).toEqual([{ artifact: "a", label: "marker", form: "html-escaped raw" }]);
    expect(scanDurableArtifactText([{ name: "ignored.ts.json", text: "{}" }], [{ label: "file", value: "ignored.ts", kind: "text" }])).toHaveLength(1);
  });

  it("does not flag authorized reproducibility metadata or redaction placeholders", () => {
    const text = JSON.stringify({ commit: "a".repeat(40), subjectId: "fixture-subject", branch: "main", observedFiles: ["<redacted file 1>"] });
    expect(scanDurableArtifactText([{ name: "report.json", text }], [{ label: "target", value: windowsRoot, kind: "path" }])).toEqual([]);
  });

  it("emits only forms the writers can produce, without duplicates", () => {
    const forms = privacyForms({ label: "p", value: "/tmp/a b", kind: "path" }).map((entry) => entry.text);
    expect(new Set(forms).size).toBe(forms.length);
    expect(forms.some((text) => text.startsWith("file:") || text.includes("%20"))).toBe(false);
  });
});

describe("external-local redaction text projection", () => {
  it("removes absolute roots and known files from error text in every separator form", () => {
    const root = "C:\\Users\\someone\\repo";
    const message = `failed at ${root}\\src\\a.ts and ${root.replace(/\\/g, "/")}/src/a.ts and scratch ${root}\\s-1\\x`;
    const redacted = redactKnownPaths(message, ["src/a.ts"], [root]);
    expect(redacted).not.toContain("someone");
    expect(redacted).not.toContain("a.ts");
  });

  it("leaves a generated placeholder intact and treats a report-field-like file name as ordinary text", () => {
    expect(redactKnownPaths("observed <redacted file 1> and <redacted file 2>", ["src/x.ts"])).toBe("observed <redacted file 1> and <redacted file 2>");
    expect(redactKnownPaths("see report.json", ["report.json"])).toBe("see <redacted file>");
  });
});

describe("public external-local run: durable privacy, truthfulness and consumers", () => {
  let target: string;
  let configPath: string;
  let outDir: string;

  beforeEach(() => {
    const base = makeTempDir("lrs b4 ");
    scratch.push(base);
    target = path.join(base, "target repo");
    configPath = path.join(base, "config dir", "local subject.json");
    outDir = path.join(base, "out dir", "run");
    buildTarget(target);
    writeConfig(configPath);
  });

  it("keeps every durable artifact free of private forms while leaving the target untouched", async () => {
    const treeBefore = listTree(target);
    const statusBefore = git(target, "status", "--porcelain=v1", "--ignored");
    const output = capture();
    expect(await runExperimentRunCommandFromArgs(runArgs(target, configPath, outDir))).toBe(0);
    expect(output.stderr()).toBe("");
    expect(listDurableFiles(outDir)).toEqual(DURABLE_FILES);
    expect(scanDurableOutputDirectory(outDir, sentinelsFor({ target, configDir: path.dirname(configPath), outDir }))).toEqual([]);
    expect(listTree(target)).toEqual(treeBefore);
    expect(git(target, "status", "--porcelain=v1", "--ignored")).toBe(statusBefore);
    expect(path.relative(target, outDir).startsWith("..")).toBe(true);
  });

  it("keeps redaction truthful and the authorized identity present", async () => {
    capture();
    expect(await runExperimentRunCommandFromArgs(runArgs(target, configPath, outDir))).toBe(0);
    const artifact = JSON.parse(readFileSync(path.join(outDir, "context-window-scaling-execution.json"), "utf8"));
    expect(checkRedactionTruthfulness(artifact)).toEqual([]);
    const raw = artifact.cases[0].treatments.find((treatment: { variantId: string }) => treatment.variantId === "raw-full-file");
    // main.ts, util/helper.ts and html-marker.ts are eligible: three placeholders, never an empty list.
    expect(raw.context.observedFiles).toEqual(["<redacted file 1>", "<redacted file 2>", "<redacted file 3>"]);
    const manifest = JSON.parse(readFileSync(path.join(outDir, "local-repository-subject-manifest.json"), "utf8"));
    const commit = git(target, "rev-parse", "HEAD").trim();
    expect(manifest.repository.commit).toBe(commit);
    expect(manifest.subjectId).toBe("fixture-subject");
    expect(manifest.repository.branch).toBe("main");
    const report = JSON.parse(readFileSync(path.join(outDir, "report.json"), "utf8"));
    expect(report.report.target).toMatchObject({ kind: "external-local", commit, privacyProjection: "external-local-redacted" });
    // The guided treatment omits helper.ts, so the human reports show an omitted-file placeholder rather than a name.
    expect(readFileSync(path.join(outDir, "report.txt"), "utf8")).toContain("<redacted file 1>");
    expect(readFileSync(path.join(outDir, "report.html"), "utf8")).toContain("&lt;redacted file 1&gt;");
  });

  it("flags a deliberately unredacted copy of the artifact (breakage proof for the scanner and truthfulness check)", async () => {
    capture();
    expect(await runExperimentRunCommandFromArgs(runArgs(target, configPath, outDir))).toBe(0);
    const sentinels = sentinelsFor({ target, configDir: path.dirname(configPath), outDir });
    const text = readFileSync(path.join(outDir, "report.json"), "utf8");
    const leaked = text.replace('"toolRoot": "[redacted]"', `"toolRoot": ${JSON.stringify(target)}`).replace('"toolRoot":"[redacted]"', `"toolRoot":${JSON.stringify(target)}`);
    expect(leaked).not.toBe(text);
    expect(scanDurableArtifactText([{ name: "report.json", text: leaked }], sentinels).length).toBeGreaterThan(0);
    const artifact = JSON.parse(readFileSync(path.join(outDir, "context-window-scaling-execution.json"), "utf8"));
    artifact.cases[0].treatments[0].relevantFileEvidence.expectedRelevantFiles = [];
    delete artifact.cases[0].treatments[1].fileIdentityRedaction;
    expect(checkRedactionTruthfulness(artifact).length).toBeGreaterThanOrEqual(2);
  });

  it("is accepted by the current artifact reader and plot consumer without resolving placeholders", async () => {
    capture();
    expect(await runExperimentRunCommandFromArgs(runArgs(target, configPath, outDir))).toBe(0);
    const artifactPath = path.join(outDir, "context-window-scaling-execution.json");
    const parsed = parseContextWindowScalingExecutionArtifact(JSON.parse(readFileSync(artifactPath, "utf8")));
    expect(parsed.cases[0].treatments.every((treatment) => treatment.context.observedFiles?.every((entry) => /^<redacted file \d+>$/.test(entry)) ?? true)).toBe(true);
    const source = await readContextWindowScalingPlotSource(outDir);
    expect(source).not.toBeNull();
    const plot = buildContextWindowScalingPlotData({ aggregate: source!.aggregate, experimentDir: outDir, generatedAt: source!.generatedAt });
    expect(plot.plots.length).toBe(3);
  });

  it("persists nothing and leaves no scratch when the run fails, whatever the failure", async () => {
    const outParent = path.dirname(outDir);
    const created = path.join(target, "src", "created.ts");
    for (const [variable, value] of [["LRS_FAKE_KIT_FILE", "src/ignored.ts"], ["LRS_FAKE_KIT_MUTATE", created]] as const) {
      process.env[variable] = value;
      const output = capture();
      expect(await runExperimentRunCommandFromArgs(runArgs(target, configPath, outDir))).toBe(1);
      const consoleText = `${output.stdout()}\n${output.stderr()}`;
      const sentinels = sentinelsFor({ target, configDir: path.dirname(configPath), outDir }).filter((entry) => entry.kind === "text" || entry.value === target);
      expect(scanDurableArtifactText([{ name: "console", text: consoleText }], sentinels)).toEqual([]);
      expect(existsSync(outParent) ? listDurableFiles(outParent) : []).toEqual([]);
      delete process.env[variable];
      vi.restoreAllMocks();
      rmSync(created, { force: true });
      rmSync(outParent, { recursive: true, force: true });
    }
  });
});

describe("path acceptance (portable; spaces, depth and length)", () => {
  function tempBase(): string {
    const base = realpathSync.native(mkdtempSync(path.join(os.tmpdir(), "lrs b4 ")));
    scratch.push(base);
    return base;
  }

  it("runs with spaces in the target, config and output paths and redacts the spaced path", async () => {
    const base = tempBase();
    const target = path.join(base, "my target repo", "inner project");
    const configPath = path.join(base, "my config", "subject config.json");
    const outDir = path.join(base, "my out", "run dir");
    buildTarget(target);
    writeConfig(configPath);
    const treeBefore = listTree(target);
    capture();
    expect(await runExperimentRunCommandFromArgs(runArgs(target, configPath, outDir))).toBe(0);
    expect(listTree(target)).toEqual(treeBefore);
    expect(listDurableFiles(outDir)).toEqual(DURABLE_FILES);
    expect(scanDurableOutputDirectory(outDir, sentinelsFor({ target, configDir: path.dirname(configPath), outDir }))).toEqual([]);
  });

  it("runs from a reasonably deep nested target", async () => {
    const base = tempBase();
    const target = path.join(base, ...Array.from({ length: 8 }, (_, index) => `level-${index + 1}`), "repository");
    const configPath = path.join(base, "cfg", "c.json");
    const outDir = path.join(base, "out");
    buildTarget(target);
    writeConfig(configPath);
    evidence(`B4_PATH_EVIDENCE deep target path length=${target.length}`);
    capture();
    expect(await runExperimentRunCommandFromArgs(runArgs(target, configPath, outDir))).toBe(0);
    expect(scanDurableOutputDirectory(outDir, sentinelsFor({ target, configDir: path.dirname(configPath), outDir }))).toEqual([]);
  });

  it("either runs a target beyond the traditional 260-character limit or fails cleanly without mutation", async () => {
    const base = tempBase();
    let target = path.join(base, "target");
    while (target.length < 300) target = path.join(target, "s".repeat(40));
    const configPath = path.join(base, "cfg", "c.json");
    const outDir = path.join(base, "out");
    writeConfig(configPath);
    let built = true;
    let buildError = "";
    try {
      buildTarget(target);
    } catch (error) {
      // Windows cannot spawn a process (git) whose working directory is beyond the limit, so a repository cannot be
      // built there. The product must still fail cleanly when it is pointed at such a directory.
      built = false;
      buildError = (error as NodeJS.ErrnoException).code ?? "git";
      mkdirSync(target, { recursive: true });
    }
    const treeBefore = listTree(target);
    const statusBefore = built ? git(target, "status", "--porcelain=v1", "--ignored") : "";
    const output = capture();
    const code = await runExperimentRunCommandFromArgs(runArgs(target, configPath, outDir));
    evidence(`B4_PATH_EVIDENCE long target path length=${target.length} repositoryCreated=${built}${built ? "" : ` (${buildError})`} productExit=${code}`);
    expect(listTree(target)).toEqual(treeBefore);
    if (built) expect(git(target, "status", "--porcelain=v1", "--ignored")).toBe(statusBefore);
    if (code === 0) {
      expect(built).toBe(true);
      expect(listDurableFiles(outDir)).toEqual(DURABLE_FILES);
      expect(scanDurableOutputDirectory(outDir, sentinelsFor({ target, configDir: path.dirname(configPath), outDir }))).toEqual([]);
    } else {
      const text = `${output.stdout()}\n${output.stderr()}`;
      expect(text.trim().length).toBeGreaterThan(0);
      expect(text.length).toBeLessThan(4000);
      expect(existsSync(outDir) ? listDurableFiles(outDir) : []).toEqual([]);
    }
  });

  it("either runs or fails cleanly and non-mutatingly when the output path is beyond 260 characters", async () => {
    const base = tempBase();
    const target = path.join(base, "target");
    const configPath = path.join(base, "cfg", "c.json");
    buildTarget(target);
    writeConfig(configPath);
    let outDir = path.join(base, "out");
    while (outDir.length < 340) outDir = path.join(outDir, "o".repeat(40));
    const treeBefore = listTree(target);
    const output = capture();
    const code = await runExperimentRunCommandFromArgs(runArgs(target, configPath, outDir));
    evidence(`B4_PATH_EVIDENCE long output path length=${outDir.length} productExit=${code}`);
    expect(listTree(target)).toEqual(treeBefore);
    if (code === 0) {
      expect(listDurableFiles(outDir)).toEqual(DURABLE_FILES);
    } else {
      const text = `${output.stdout()}\n${output.stderr()}`;
      expect(text.trim().length).toBeGreaterThan(0);
      expect(existsSync(outDir) ? listDurableFiles(outDir) : []).toEqual([]);
      expect(listDurableFiles(base).filter((name) => DURABLE_FILES.includes(path.posix.basename(name)))).toEqual([]);
    }
  });
});
