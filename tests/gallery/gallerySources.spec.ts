import { mkdtempSync } from "node:fs";
import { mkdir, readdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseBuildGalleryArgs, runBuildGalleryCommand } from "../../src/commands/buildGalleryCommand.js";
import { renderGalleryIndex } from "../../src/gallery/index.js";
import type { GalleryManifest } from "../../src/gallery/index.js";
import { isSafeRelativeArtifactPath, safeGalleryHref } from "../../src/gallery/galleryPathSafety.js";

const WEBM = Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(16)]);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.alloc(16)]);

const tempDirs: string[] = [];
let stderr: string[] = [];

beforeEach(() => {
  stderr = [];
  vi.spyOn(console, "error").mockImplementation((message?: unknown) => {
    stderr.push(String(message));
  });
  vi.spyOn(console, "log").mockImplementation(() => undefined);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function tempRoot(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "gallery-src-"));
  tempDirs.push(dir);
  return dir;
}

type TutorialOptions = {
  status?: string;
  schemaVersion?: string;
  title?: string;
  warnings?: string[];
  artifacts?: Array<Record<string, unknown>> | null;
  omit?: string[];
};

async function writeTutorialRun(runRoot: string, options: TutorialOptions = {}): Promise<string> {
  await mkdir(path.join(runRoot, "artifacts"), { recursive: true });
  await mkdir(path.join(runRoot, "screenshots"), { recursive: true });
  await writeFile(path.join(runRoot, "video.webm"), WEBM);
  await writeFile(path.join(runRoot, "screenshots", "s1.png"), PNG);
  await writeFile(path.join(runRoot, "tutorial.md"), "# Tutorial\n\n<script>alert(1)</script>\n");
  const defaults = [
    { kind: "video", status: "written", path: "video.webm" },
    { kind: "screenshot", id: "s1", status: "written", path: "screenshots/s1.png" },
    { kind: "markdown", status: "written", path: "tutorial.md" },
    { kind: "manifest", status: "written", path: "artifacts/tutorial-manifest.json" }
  ].filter((record) => !(options.omit ?? []).includes(record.kind));
  const manifest = {
    schemaVersion: options.schemaVersion ?? "1.0.0",
    scenario: { schemaVersion: "1.0.0", id: "demo", title: options.title ?? "Demo tutorial", description: "A demo", targetId: "t" },
    target: { schemaVersion: "1.0.0", id: "t", applicationUrl: "http://localhost:1" },
    run: { id: "run-1", status: options.status ?? "passed", startedAt: "2026-01-01T00:00:00Z", endedAt: "2026-01-01T00:00:01Z", durationMs: 1000 },
    environment: { platform: "win32", nodeVersion: "v24" },
    steps: [{ id: "a", status: "passed", narration: "n", assertions: [], highlightRequested: false, calloutRequested: false }],
    artifacts: options.artifacts === undefined ? defaults : options.artifacts,
    warnings: options.warnings ?? [],
    cleanupErrors: []
  };
  const file = path.join(runRoot, "artifacts", "tutorial-manifest.json");
  await writeFile(file, `${JSON.stringify(manifest, null, 2)}\n`);
  return file;
}

async function build(args: string[], outDir: string): Promise<{ code: number; manifest?: GalleryManifest; html?: string }> {
  const code = await runBuildGalleryCommand([...args, "--out", outDir]);
  if (code !== 0) return { code };
  return {
    code,
    manifest: JSON.parse(await readFile(path.join(outDir, "gallery-manifest.json"), "utf8")) as GalleryManifest,
    html: await readFile(path.join(outDir, "gallery-index.html"), "utf8")
  };
}

describe("gallery build --source: CLI contract", () => {
  it("keeps every existing option and adds repeatable --source", () => {
    const parsed = parseBuildGalleryArgs(["--report", "r", "--plots", "p", "--visualizations", "v", "--experiment", "e", "--source", "a", "--source", "b", "--out", "o"]);
    expect(parsed).toMatchObject({ reportDir: "r", plotsDir: "p", visualizationsDir: "v", experimentDir: "e", outDir: "o", sources: ["a", "b"] });
    expect(parseBuildGalleryArgs(["--out", "o"]).sources).toBeUndefined();
  });

  it("rejects a missing, empty or flag-like --source value and URLs", async () => {
    expect(() => parseBuildGalleryArgs(["--out", "o", "--source"])).toThrow(/--source requires/);
    expect(() => parseBuildGalleryArgs(["--out", "o", "--source", ""])).toThrow(/--source requires/);
    expect(() => parseBuildGalleryArgs(["--source", "--out", "o"])).toThrow(/--source requires/);
    const root = tempRoot();
    expect(await runBuildGalleryCommand(["--source", "https://example.com/x", "--out", path.join(root, "g")])).toBe(1);
    expect(stderr.join("\n")).toMatch(/URLs are not supported/);
    expect(await runBuildGalleryCommand(["--source", "javascript:alert(1)", "--out", path.join(root, "g")])).toBe(1);
  });

  it("combines legacy inputs with sources, preserves source order, and deduplicates repeats", async () => {
    const root = tempRoot();
    const reportDir = path.join(root, "report");
    await mkdir(reportDir, { recursive: true });
    await writeFile(path.join(reportDir, "experiment-report.html"), "<html></html>");
    const runA = path.join(root, "run-a");
    const runB = path.join(root, "run-b");
    const manifestA = await writeTutorialRun(runA, { title: "Tutorial A" });
    await writeTutorialRun(runB, { title: "Tutorial B" });
    const result = await build(["--report", reportDir, "--source", runB, "--source", runA, "--source", manifestA, "--source", runB], path.join(root, "gallery"));
    expect(result.code).toBe(0);
    const titles = result.manifest!.items.map((item) => item.title);
    expect(titles).toEqual(["Experiment report", "Tutorial B", "Tutorial A", "Final demo artifact index"]);
    expect(result.manifest!.items.find((item) => item.id === "final-demo")?.metrics[0]?.value).toBe(3);
  });

  it("rejects an unsupported or unrecognizable source", async () => {
    const root = tempRoot();
    const empty = path.join(root, "empty");
    await mkdir(empty, { recursive: true });
    expect(await runBuildGalleryCommand(["--source", empty, "--out", path.join(root, "g")])).toBe(1);
    expect(stderr.join("\n")).toMatch(/no supported artifact family/);
    const stray = path.join(root, "notes.txt");
    await writeFile(stray, "hello");
    expect(await runBuildGalleryCommand(["--source", stray, "--out", path.join(root, "g")])).toBe(1);
    expect(stderr.join("\n")).toMatch(/unsupported source type/);
    expect(await runBuildGalleryCommand(["--source", path.join(root, "missing"), "--out", path.join(root, "g")])).toBe(1);
  });
});

describe("artifact family readers", () => {
  const pluginReport = (extra: Record<string, unknown> = {}, status = "completed") => ({
    metadata: { runId: "run-9", status, generatedAt: "2026-01-01T00:00:00Z", outputRoot: "C:\\secret\\out" },
    plugin: { id: "retrieval-precision-recall", name: "Retrieval Precision Recall" },
    target: { privacyProjection: "external-local-redacted", targetRoot: "C:\\secret\\target" },
    variants: [],
    metrics: [{ id: "m", name: "m", value: 1 }],
    ...extra
  });

  async function single(files: Record<string, unknown | Buffer | string>): Promise<{ code: number; manifest?: GalleryManifest; html?: string; root: string }> {
    const root = tempRoot();
    const src = path.join(root, "src");
    await mkdir(src, { recursive: true });
    for (const [name, content] of Object.entries(files)) {
      await writeFile(path.join(src, name), Buffer.isBuffer(content) || typeof content === "string" ? content : JSON.stringify(content));
    }
    return { ...(await build(["--source", src], path.join(root, "gallery"))), root };
  }

  it("reads a generic plugin experiment report without exposing machine-local target paths", async () => {
    const result = await single({ "report.json": pluginReport(), "report.html": "<html></html>", "report.txt": "t" });
    const item = result.manifest!.items[0]!;
    expect(item).toMatchObject({ kind: "plugin-experiment-report", sourceFamily: "plugin-experiment-report", status: "pass" });
    expect(item.htmlPath).toMatch(/report\.html$/);
    expect(item.tags).toContain("external-local-redacted");
    expect(JSON.stringify(result.manifest)).not.toContain("secret");
    expect(result.html).not.toContain("secret");
  });

  it("does not report success for a failed run or invent an HTML path", async () => {
    const result = await single({ "report.json": pluginReport({}, "failed") });
    const item = result.manifest!.items[0]!;
    expect(item.status).toBe("warning");
    expect(item.htmlPath).toBe("");
    expect(item.warnings.join(" ")).toMatch(/failed/);
    expect(item.warnings.join(" ")).toMatch(/HTML report unavailable/);
  });

  it("recognizes a warm-index campaign report", async () => {
    const result = await single({
      "report.json": pluginReport({ plugin: { id: "warm-index-reuse", name: "Warm Index Reuse" }, warmIndexReuse: { agentCampaign: { tokenEvidenceStatus: "partial" } } }),
      "warm-index-execution.json": "{}"
    });
    const item = result.manifest!.items[0]!;
    expect(item).toMatchObject({ kind: "warm-index-campaign-report", sourceFamily: "warm-index-campaign" });
    expect(item.artifactPaths?.some((p) => p.endsWith("warm-index-execution.json"))).toBe(true);
  });

  it("reads controlled experiment, audit, security and android reports from one root with distinct identities", async () => {
    const result = await single({
      "experiment-summary.json": { generatedAt: "g", totalRuns: 4, completedRuns: 4, failedRuns: 0, strategies: ["a"] },
      "code-rot-audit.json": { schemaVersion: "1.0", metadata: { reportType: "code-rot-audit", generatedAt: "g", auditTypes: ["code-rot"] }, summary: { totalIssues: 2 }, exit: { failOnBreached: true, finalExitCode: 1, finalVerdictLabel: "fail-on threshold breached" } },
      "p-security-validation.json": { schemaVersion: 1, metadata: { generatedAt: "g" }, summary: { totalChecks: 3, failed: 0, totalFindings: 0, blockerFindings: 0 }, verdict: "ready-for-release-preparation", checks: [], findings: [] },
      "p-android-security-validation.json": { executiveSummary: "x", androidProjectSummary: {}, metadata: { generatedAt: "g" }, verdict: "not-ready-security-blocker-remains" }
    });
    const byKind = Object.fromEntries(result.manifest!.items.map((item) => [item.kind, item]));
    expect(byKind["controlled-experiment"]?.status).toBe("pass");
    expect(byKind["audit-report"]?.status).toBe("warning");
    expect(byKind["security-validation-report"]?.status).toBe("pass");
    expect(byKind["android-validation-report"]?.status).toBe("warning");
    const ids = result.manifest!.items.map((item) => item.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("never invents a pass status when the producer recorded none", async () => {
    const result = await single({
      "code-rot-audit.json": { schemaVersion: "1.0", metadata: { reportType: "code-rot-audit" }, summary: {} }
    });
    expect(result.manifest!.items[0]).toMatchObject({ status: "warning" });
    expect(result.manifest!.items[0]!.warnings.join(" ")).toMatch(/not recorded/);
  });

  it("fails closed on malformed or unsupported known-family documents", async () => {
    expect((await single({ "code-rot-audit.json": "{ not json" })).code).toBe(1);
    expect((await single({ "code-rot-audit.json": { schemaVersion: "9.9", metadata: { reportType: "code-rot-audit" }, summary: {} } })).code).toBe(1);
    expect(stderr.join("\n")).toMatch(/unsupported audit report schemaVersion/);
    expect((await single({ "p-security-validation.json": { schemaVersion: 2, summary: {}, checks: [], findings: [], verdict: "x" } })).code).toBe(1);
    expect((await single({ "experiment-summary.json": { hello: "world" } })).code).toBe(1);
  });

  it("refuses an ambiguous family signature", async () => {
    const result = await single({
      "p-security-validation.json": { schemaVersion: 1, summary: {}, checks: [], findings: [], verdict: "v", executiveSummary: "x", androidProjectSummary: {} }
    });
    expect(result.code).toBe(1);
    expect(stderr.join("\n")).toMatch(/more than one artifact family/);
  });
});

describe("tutorial manifest consumption", () => {
  it("displays a passed tutorial with video, screenshots and Markdown from an output directory elsewhere", async () => {
    const root = tempRoot();
    const run = path.join(root, "runs", "run-1");
    await writeTutorialRun(run);
    const out = path.join(root, "out", "nested", "gallery");
    const result = await build(["--source", run], out);
    expect(result.code).toBe(0);
    const item = result.manifest!.items[0]!;
    expect(item).toMatchObject({ kind: "tutorial-run", status: "pass", sourceFamily: "tutorial-run", sourceId: "demo/run-1", htmlPath: "" });
    expect(item.videoPath).toBe("../../../runs/run-1/video.webm");
    expect(item.screenshotPaths).toEqual(["../../../runs/run-1/screenshots/s1.png"]);
    expect(item.markdownPath).toBe("../../../runs/run-1/tutorial.md");
    expect(result.html).toContain('<video controls preload="metadata" src="../../../runs/run-1/video.webm"');
    expect(result.html).not.toMatch(/autoplay/i);
    expect(result.html).toContain('<img src="../../../runs/run-1/screenshots/s1.png"');
    expect(result.html).toContain('href="../../../runs/run-1/tutorial.md"');
    expect(result.html).toContain("Run status: <strong>passed</strong>");
  });

  it("never presents a failed run as passed and keeps the factual status", async () => {
    const root = tempRoot();
    const run = path.join(root, "run");
    await writeTutorialRun(run, { status: "step-failed" });
    const result = await build(["--source", run], path.join(root, "g"));
    const item = result.manifest!.items[0]!;
    expect(item.status).toBe("warning");
    expect(item.metrics.find((metric) => metric.id === "run-status")?.value).toBe("step-failed");
    expect(item.warnings[0]).toMatch(/did not pass/);
    expect(result.html).toContain("step-failed");
    expect(result.html).not.toMatch(/Status: <strong>pass<\/strong>[^]*tutorial-run/);
  });

  it("represents missing optional media as unavailable with a reason and emits no broken link", async () => {
    const root = tempRoot();
    const run = path.join(root, "run");
    await writeTutorialRun(run, { omit: ["video", "screenshot", "markdown"] });
    const result = await build(["--source", run], path.join(root, "g"));
    const item = result.manifest!.items[0]!;
    expect(item.videoPath).toBeUndefined();
    expect(item.screenshotPaths).toBeUndefined();
    expect(item.markdownPath).toBeUndefined();
    expect(item.warnings.join("\n")).toMatch(/Video unavailable: not recorded/);
    expect(item.warnings.join("\n")).toMatch(/Screenshot unavailable/);
    expect(item.warnings.join("\n")).toMatch(/Markdown unavailable/);
    expect(result.html).not.toContain("<video");
    expect(result.html).not.toContain("<img");
  });

  it("treats a written record whose file is missing as unavailable", async () => {
    const root = tempRoot();
    const run = path.join(root, "run");
    await writeTutorialRun(run);
    await rm(path.join(run, "video.webm"));
    const result = await build(["--source", run], path.join(root, "g"));
    expect(result.manifest!.items[0]!.videoPath).toBeUndefined();
    expect(result.manifest!.items[0]!.warnings.join("\n")).toMatch(/Video unavailable: the file is missing/);
  });

  it("accepts the canonical manifest file and rejects unknown versions and malformed manifests", async () => {
    const root = tempRoot();
    const run = path.join(root, "run");
    const manifestFile = await writeTutorialRun(run);
    expect((await build(["--source", manifestFile], path.join(root, "g1"))).code).toBe(0);
    await writeTutorialRun(run, { schemaVersion: "2.0.0" });
    expect(await runBuildGalleryCommand(["--source", run, "--out", path.join(root, "g2")])).toBe(1);
    expect(stderr.join("\n")).toMatch(/unsupported tutorial manifest schemaVersion/);
    await writeFile(manifestFile, "{ nope");
    expect(await runBuildGalleryCommand(["--source", run, "--out", path.join(root, "g3")])).toBe(1);
    await writeTutorialRun(run, { artifacts: null });
    const broken = JSON.parse(await readFile(manifestFile, "utf8")) as Record<string, unknown>;
    broken.artifacts = "nope";
    await writeFile(manifestFile, JSON.stringify(broken));
    expect(await runBuildGalleryCommand(["--source", run, "--out", path.join(root, "g4")])).toBe(1);
    expect(stderr.join("\n")).toMatch(/malformed tutorial manifest/);
  });

  it("does not modify the tutorial run directory", async () => {
    const root = tempRoot();
    const run = path.join(root, "run");
    const manifestFile = await writeTutorialRun(run);
    const before = await readFile(manifestFile, "utf8");
    const listing = JSON.stringify(await readdir(run, { recursive: true }));
    await build(["--source", run], path.join(root, "g"));
    expect(await readFile(manifestFile, "utf8")).toBe(before);
    expect(JSON.stringify(await readdir(run, { recursive: true }))).toBe(listing);
  });

  it("keeps tutorial execution independent of the gallery", async () => {
    const dir = path.resolve(import.meta.dirname, "../../src/tutorial");
    for (const name of await readdir(dir)) {
      const text = await readFile(path.join(dir, name), "utf8");
      expect(text, name).not.toMatch(/from\s+["'][^"']*gallery[^"']*["']/);
    }
  });
});

describe("path, media and HTML safety", () => {
  async function runWith(artifacts: Array<Record<string, unknown>>, prepare?: (run: string) => Promise<void>) {
    const root = tempRoot();
    const run = path.join(root, "run");
    await writeTutorialRun(run, { artifacts });
    if (prepare) await prepare(run);
    return { ...(await build(["--source", run], path.join(root, "g"))), root, run };
  }

  it("rejects traversal, absolute, drive, UNC, encoded and NUL references", async () => {
    for (const bad of ["../outside.webm", "a/../../outside.webm", "/etc/x.webm", "C:\\x\\v.webm", "C:/x/v.webm", "\\\\server\\share\\v.webm", "//server/share/v.webm", "v%2e%2e.webm", "v\u0000.webm", "https://e.com/v.webm", "javascript:alert(1).webm"]) {
      expect(isSafeRelativeArtifactPath(bad), bad).toBe(false);
      const result = await runWith([{ kind: "video", status: "written", path: bad }]);
      expect(result.code).toBe(0);
      expect(result.manifest!.items[0]!.videoPath, bad).toBeUndefined();
      expect(result.manifest!.items[0]!.warnings.join(" "), bad).toMatch(/Video unavailable/);
    }
  });

  it("rejects unsupported media and content that masquerades as media", async () => {
    const mp4 = await runWith([{ kind: "video", status: "written", path: "video.mp4" }], async (run) => writeFile(path.join(run, "video.mp4"), WEBM));
    expect(mp4.manifest!.items[0]!.videoPath).toBeUndefined();
    const fake = await runWith([{ kind: "screenshot", status: "written", path: "fake.png" }], async (run) => writeFile(path.join(run, "fake.png"), "<svg onload=alert(1)>"));
    expect(fake.manifest!.items[0]!.screenshotPaths).toBeUndefined();
    expect(fake.manifest!.items[0]!.warnings.join(" ")).toMatch(/not a valid png/);
    const svg = await runWith([{ kind: "screenshot", status: "written", path: "x.svg" }], async (run) => writeFile(path.join(run, "x.svg"), "<svg/>"));
    expect(svg.manifest!.items[0]!.screenshotPaths).toBeUndefined();
  });

  it("rejects a link that escapes the source root through a junction or symlink", async () => {
    const result = await runWith([{ kind: "video", status: "written", path: "escape/video.webm" }], async (run) => {
      const outside = path.join(path.dirname(run), "outside");
      await mkdir(outside, { recursive: true });
      await writeFile(path.join(outside, "video.webm"), WEBM);
      await symlink(outside, path.join(run, "escape"), "junction");
    });
    expect(result.code).toBe(0);
    expect(result.manifest!.items[0]!.videoPath).toBeUndefined();
    expect(result.manifest!.items[0]!.warnings.join(" ")).toMatch(/outside the source root/);
  });

  it("escapes titles and warnings and prevents attribute injection", async () => {
    const root = tempRoot();
    const run = path.join(root, "run");
    const evil = `"><img src=x onerror=alert(1)><script>alert(2)</script>`;
    await writeTutorialRun(run, { title: evil, warnings: [evil] });
    const result = await build(["--source", run], path.join(root, "g"));
    const html = result.html!;
    expect(html).not.toContain("<script>alert(2)");
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;script&gt;alert(2)&lt;/script&gt;");
  });

  it("validates href/src independently of text escaping and encodes valid cross-directory links", () => {
    for (const bad of ["javascript:alert(1)", "data:text/html,x", "file:///etc/passwd", "https://example.com/a.webm", "//example.com/a.webm", "/abs/a.webm", "a\\b.webm", "a/../b.webm", "a/./b.webm", "a b.webm\u0000", "x%2fy.webm", ""]) {
      expect(safeGalleryHref(bad), bad).toBeNull();
    }
    expect(safeGalleryHref("../../run/a b.webm", [".webm"])).toBe("../../run/a%20b.webm");
    expect(safeGalleryHref("../x/a.webm", [".png"])).toBeNull();
    const manifest: GalleryManifest = {
      generatedAt: "g",
      projectName: "p",
      title: "t",
      description: "d",
      outputDirectory: ".",
      warnings: [],
      items: [
        {
          id: "x",
          title: "x",
          description: "d",
          kind: "tutorial-run",
          status: "pass",
          htmlPath: "",
          sourceFamily: "tutorial-run",
          videoPath: "javascript:alert(1)",
          markdownPath: "data:text/html,<script>",
          screenshotPaths: ["https://evil.example/a.png", "../ok/a.png"],
          artifactPaths: ["file:///etc/passwd"],
          metrics: [],
          warnings: []
        }
      ]
    };
    const html = renderGalleryIndex(manifest);
    expect(html).not.toMatch(/(?:src|href)="(?:javascript|data|file|https?):/i);
    expect(html).toContain('src="../ok/a.png"');
    expect(html).toContain("Video unavailable");
    expect(html).not.toMatch(/<script|https?:\/\//);
  });

  it("keeps the legacy gallery rendering and manifest fields unchanged", async () => {
    const root = tempRoot();
    const reportDir = path.join(root, "report");
    await mkdir(reportDir, { recursive: true });
    await writeFile(path.join(reportDir, "experiment-report.html"), "<html></html>");
    const result = await build(["--report", reportDir], path.join(root, "g"));
    const item = result.manifest!.items[0]!;
    expect(Object.keys(item).sort()).toEqual(["description", "htmlPath", "id", "kind", "metrics", "status", "summaryPath", "tags", "title", "warnings", "artifactPaths", "screenshotPath"].filter((key) => key in item).sort());
    expect(item.sourceFamily).toBeUndefined();
    expect(result.html).not.toContain("Source family");
    expect(Object.keys(result.manifest!).sort()).toEqual(["description", "generatedAt", "items", "outputDirectory", "projectName", "title", "warnings"]);
  });
});
