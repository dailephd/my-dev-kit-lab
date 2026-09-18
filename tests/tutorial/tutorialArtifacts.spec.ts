import { mkdirSync, mkdtempSync, writeFileSync, existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  TUTORIAL_MANIFEST_FILENAME,
  TUTORIAL_MARKDOWN_FILENAME,
  TUTORIAL_SRT_FILENAME,
  TUTORIAL_VIDEO_FILENAME,
  TUTORIAL_VTT_FILENAME,
  buildScreenshotPath,
  buildTutorialArtifactPaths,
  finalizeTutorialVideo,
  removeTemporaryVideoFiles,
  toRunRelativePosixPath,
  verifyArtifactFile,
  writeTextArtifact
} from "../../src/tutorial/tutorialArtifacts.js";
import { buildTutorialRunPaths, createTutorialRunDirectories } from "../../src/tutorial/tutorialPaths.js";
import { createFakeVideo } from "./tutorialTestHelpers.js";

const tempDirs: string[] = [];
afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function makeRun() {
  const root = mkdtempSync(path.join(os.tmpdir(), "tutorial-artifacts-"));
  tempDirs.push(root);
  const paths = buildTutorialRunPaths({
    workspaceRoot: root,
    invocationCwd: root,
    scenarioId: "demo",
    runId: "run",
    outDir: path.join(root, "run")
  });
  await createTutorialRunDirectories(paths);
  return paths;
}

describe("canonical artifact paths", () => {
  it("places every canonical artifact under artifactsRoot with its fixed name", async () => {
    const paths = await makeRun();
    const artifacts = buildTutorialArtifactPaths(paths);

    expect(path.basename(artifacts.video)).toBe(TUTORIAL_VIDEO_FILENAME);
    expect(path.basename(artifacts.srt)).toBe(TUTORIAL_SRT_FILENAME);
    expect(path.basename(artifacts.vtt)).toBe(TUTORIAL_VTT_FILENAME);
    expect(path.basename(artifacts.markdown)).toBe(TUTORIAL_MARKDOWN_FILENAME);
    expect(path.basename(artifacts.manifest)).toBe(TUTORIAL_MANIFEST_FILENAME);

    for (const filePath of [artifacts.video, artifacts.srt, artifacts.vtt, artifacts.markdown, artifacts.manifest]) {
      expect(path.dirname(filePath)).toBe(paths.artifactsRoot);
    }
    // Raw recording stays under the run's temporary root.
    expect(path.relative(paths.temporaryRoot, artifacts.videoTempDir).startsWith("..")).toBe(false);
  });

  it("contains screenshots under screenshotsRoot by validated id only", async () => {
    const paths = await makeRun();
    expect(buildScreenshotPath(paths, "header-associated")).toBe(
      path.join(paths.screenshotsRoot, "header-associated.png")
    );
    // Scenario JSON can never supply a path; an id that escaped validation still fails here.
    expect(() => buildScreenshotPath(paths, "../escape")).toThrow(/escapes target root/);
  });
});

describe("toRunRelativePosixPath", () => {
  it("produces run-relative POSIX paths, never absolute machine paths", async () => {
    const paths = await makeRun();
    const relative = toRunRelativePosixPath(paths.runRoot, path.join(paths.artifactsRoot, "tutorial.webm"));

    expect(relative).toBe("artifacts/tutorial.webm");
    expect(relative).not.toContain("\\");
    expect(relative).not.toMatch(/^[A-Za-z]:/);
  });
});

describe("verifyArtifactFile", () => {
  it("accepts a non-empty regular file and reports its size", async () => {
    const paths = await makeRun();
    const filePath = path.join(paths.artifactsRoot, "thing.txt");
    writeFileSync(filePath, "hello", "utf8");

    const check = await verifyArtifactFile(filePath);
    expect(check).toEqual({ ok: true, sizeBytes: 5 });
  });

  it("rejects a missing file, a directory and an empty file", async () => {
    const paths = await makeRun();
    const missing = await verifyArtifactFile(path.join(paths.artifactsRoot, "absent.txt"));
    expect(missing.ok).toBe(false);

    const directory = path.join(paths.artifactsRoot, "dir");
    mkdirSync(directory);
    const dirCheck = await verifyArtifactFile(directory);
    expect(dirCheck.ok).toBe(false);
    if (!dirCheck.ok) expect(dirCheck.error).toContain("not a regular file");

    const empty = path.join(paths.artifactsRoot, "empty.txt");
    writeFileSync(empty, "", "utf8");
    const emptyCheck = await verifyArtifactFile(empty);
    expect(emptyCheck.ok).toBe(false);
    if (!emptyCheck.ok) expect(emptyCheck.error).toContain("empty");
  });
});

describe("writeTextArtifact", () => {
  it("writes and verifies an artifact, returning a relative record", async () => {
    const paths = await makeRun();
    const record = await writeTextArtifact({
      kind: "srt",
      runRoot: paths.runRoot,
      filePath: path.join(paths.artifactsRoot, "tutorial.srt"),
      contents: "1\n00:00:00,000 --> 00:00:01,000\nhi\n"
    });

    expect(record).toMatchObject({ kind: "srt", status: "written", path: "artifacts/tutorial.srt" });
    expect(record.sizeBytes).toBeGreaterThan(0);
  });

  it("returns a failed record rather than throwing when the write fails", async () => {
    const paths = await makeRun();
    // A directory path cannot be written as a file.
    const target = path.join(paths.artifactsRoot, "blocked");
    mkdirSync(target);

    const record = await writeTextArtifact({
      kind: "markdown",
      runRoot: paths.runRoot,
      filePath: target,
      contents: "x"
    });

    expect(record.status).toBe("failed");
    expect(record.error).toContain("Could not write");
    expect(record.path).toBe("artifacts/blocked");
  });

  it("marks an empty artifact as failed", async () => {
    const paths = await makeRun();
    const record = await writeTextArtifact({
      kind: "srt",
      runRoot: paths.runRoot,
      filePath: path.join(paths.artifactsRoot, "tutorial.srt"),
      contents: ""
    });

    expect(record.status).toBe("failed");
    expect(record.error).toContain("empty");
  });
});

describe("finalizeTutorialVideo", () => {
  it("saves the canonical WebM and removes the raw temporary recording", async () => {
    const paths = await makeRun();
    const artifacts = buildTutorialArtifactPaths(paths);
    mkdirSync(artifacts.videoTempDir, { recursive: true });
    const rawPath = path.join(artifacts.videoTempDir, "page-abc.webm");
    writeFileSync(rawPath, Buffer.from("raw-bytes"));

    const video = createFakeVideo({ rawPath });
    const result = await finalizeTutorialVideo({
      video,
      runRoot: paths.runRoot,
      videoPath: artifacts.video,
      videoTempDir: artifacts.videoTempDir
    });

    expect(result.record).toMatchObject({ kind: "video", status: "written", path: "artifacts/tutorial.webm" });
    expect(result.record.sizeBytes).toBeGreaterThan(0);
    expect(video.savedTo).toEqual([artifacts.video]);
    expect(existsSync(artifacts.video)).toBe(true);
    // Raw recording cleaned up; the canonical artifact is untouched.
    expect(existsSync(rawPath)).toBe(false);
  });

  it("reports skipped when the page exposed no video", async () => {
    const paths = await makeRun();
    const artifacts = buildTutorialArtifactPaths(paths);

    const result = await finalizeTutorialVideo({
      video: null,
      runRoot: paths.runRoot,
      videoPath: artifacts.video,
      videoTempDir: artifacts.videoTempDir
    });

    expect(result.record.status).toBe("skipped");
    expect(result.record.error).toContain("no recorded video");
  });

  it("reports failed and retains the raw recording when saveAs fails", async () => {
    const paths = await makeRun();
    const artifacts = buildTutorialArtifactPaths(paths);
    mkdirSync(artifacts.videoTempDir, { recursive: true });
    const rawPath = path.join(artifacts.videoTempDir, "page-abc.webm");
    writeFileSync(rawPath, Buffer.from("raw-bytes"));

    const result = await finalizeTutorialVideo({
      video: createFakeVideo({ rawPath, saveAsError: new Error("transport closed") }),
      runRoot: paths.runRoot,
      videoPath: artifacts.video,
      videoTempDir: artifacts.videoTempDir
    });

    expect(result.record.status).toBe("failed");
    expect(result.record.error).toContain("transport closed");
    expect(result.warnings.join("\n")).toContain(rawPath);
    // Retained for diagnosis.
    expect(existsSync(rawPath)).toBe(true);
  });

  it("reports failed when the saved video is empty", async () => {
    const paths = await makeRun();
    const artifacts = buildTutorialArtifactPaths(paths);

    const result = await finalizeTutorialVideo({
      video: createFakeVideo({
        onSave: (target) => {
          writeFileSync(target, Buffer.alloc(0));
        }
      }),
      runRoot: paths.runRoot,
      videoPath: artifacts.video,
      videoTempDir: artifacts.videoTempDir
    });

    expect(result.record.status).toBe("failed");
    expect(result.record.error).toContain("empty");
  });
});

describe("removeTemporaryVideoFiles", () => {
  it("removes only .webm recordings and tolerates a missing directory", async () => {
    const paths = await makeRun();
    const artifacts = buildTutorialArtifactPaths(paths);
    mkdirSync(artifacts.videoTempDir, { recursive: true });
    writeFileSync(path.join(artifacts.videoTempDir, "a.webm"), "x");
    writeFileSync(path.join(artifacts.videoTempDir, "keep.txt"), "x");

    expect(await removeTemporaryVideoFiles(artifacts.videoTempDir)).toBeUndefined();
    expect(existsSync(path.join(artifacts.videoTempDir, "a.webm"))).toBe(false);
    expect(existsSync(path.join(artifacts.videoTempDir, "keep.txt"))).toBe(true);

    expect(await removeTemporaryVideoFiles(path.join(paths.temporaryRoot, "absent"))).toBeUndefined();
  });
});
