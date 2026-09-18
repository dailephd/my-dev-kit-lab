import { readdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { PlaywrightLikeVideo } from "../browser/types.js";
import { resolveWithinRoot } from "../core/pathSafety.js";
import type {
  TutorialArtifactKind,
  TutorialArtifactRecordV1,
  TutorialRunPaths
} from "./types.js";

/**
 * Canonical tutorial artifact paths, writing, finalization and verification.
 *
 * Every artifact this module writes is contained inside the run's own
 * TutorialRunPaths roots. Nothing here accepts an output path from scenario
 * JSON: screenshot identity comes from the validated stable-id contract and
 * everything else has a fixed canonical name.
 */

export const TUTORIAL_VIDEO_FILENAME = "tutorial.webm";
export const TUTORIAL_SRT_FILENAME = "tutorial.srt";
export const TUTORIAL_VTT_FILENAME = "tutorial.vtt";
export const TUTORIAL_MARKDOWN_FILENAME = "tutorial.md";
export const TUTORIAL_MANIFEST_FILENAME = "tutorial-manifest.json";

/** Subdirectory of temporaryRoot that Playwright records raw video into. */
export const TUTORIAL_VIDEO_TEMP_DIR_NAME = "video";

export type TutorialArtifactPaths = {
  video: string;
  srt: string;
  vtt: string;
  markdown: string;
  manifest: string;
  videoTempDir: string;
};

export function buildTutorialArtifactPaths(paths: TutorialRunPaths): TutorialArtifactPaths {
  return {
    video: path.join(paths.artifactsRoot, TUTORIAL_VIDEO_FILENAME),
    srt: path.join(paths.artifactsRoot, TUTORIAL_SRT_FILENAME),
    vtt: path.join(paths.artifactsRoot, TUTORIAL_VTT_FILENAME),
    markdown: path.join(paths.artifactsRoot, TUTORIAL_MARKDOWN_FILENAME),
    manifest: path.join(paths.artifactsRoot, TUTORIAL_MANIFEST_FILENAME),
    videoTempDir: path.join(paths.temporaryRoot, TUTORIAL_VIDEO_TEMP_DIR_NAME)
  };
}

/**
 * Absolute path for a validated screenshot id, contained under screenshotsRoot.
 *
 * The id has already passed the stable-id pattern, so it cannot contain a
 * separator or traversal; the containment check is belt-and-braces and would
 * catch any future loosening of that contract.
 */
export function buildScreenshotPath(paths: TutorialRunPaths, screenshotId: string): string {
  return resolveWithinRoot(paths.screenshotsRoot, `${screenshotId}.png`);
}

/**
 * Run-root-relative POSIX path used in every stored artifact record, so a
 * manifest never carries `C:\Users\...` or `/home/runner/...`.
 */
export function toRunRelativePosixPath(runRoot: string, absolutePath: string): string {
  return path.relative(path.resolve(runRoot), path.resolve(absolutePath)).split(path.sep).join("/");
}

export type ArtifactFileCheck =
  | { ok: true; sizeBytes: number }
  | { ok: false; error: string };

/** Confirms a canonical artifact is a regular file and, when required, non-empty. */
export async function verifyArtifactFile(
  filePath: string,
  options: { requireNonEmpty?: boolean } = {}
): Promise<ArtifactFileCheck> {
  let stats;
  try {
    stats = await stat(filePath);
  } catch (error) {
    return { ok: false, error: `Artifact file is missing: ${filePath} (${messageOf(error)})` };
  }
  if (!stats.isFile()) {
    return { ok: false, error: `Artifact path is not a regular file: ${filePath}` };
  }
  if ((options.requireNonEmpty ?? true) && stats.size === 0) {
    return { ok: false, error: `Artifact file is empty: ${filePath}` };
  }
  return { ok: true, sizeBytes: stats.size };
}

/**
 * Writes one text artifact and verifies it landed, returning a record either way.
 * A write failure is data, not an exception, so a run can continue to the next
 * artifact and report every failure together.
 */
export async function writeTextArtifact(options: {
  kind: TutorialArtifactKind;
  runRoot: string;
  filePath: string;
  contents: string;
}): Promise<TutorialArtifactRecordV1> {
  const relativePath = toRunRelativePosixPath(options.runRoot, options.filePath);
  try {
    await writeFile(options.filePath, options.contents, "utf8");
  } catch (error) {
    return {
      kind: options.kind,
      status: "failed",
      path: relativePath,
      error: `Could not write ${relativePath}: ${messageOf(error)}`
    };
  }

  const check = await verifyArtifactFile(options.filePath);
  if (!check.ok) {
    return { kind: options.kind, status: "failed", path: relativePath, error: check.error };
  }
  return { kind: options.kind, status: "written", path: relativePath, sizeBytes: check.sizeBytes };
}

export type FinalizeVideoOptions = {
  video: PlaywrightLikeVideo | null;
  runRoot: string;
  videoPath: string;
  videoTempDir: string;
};

export type FinalizeVideoResult = {
  record: TutorialArtifactRecordV1;
  warnings: string[];
};

/**
 * Saves Playwright's recording to the canonical tutorial.webm.
 *
 * The page must already be closed: Playwright only finalizes a recording on page
 * close, so `saveAs()` before that would either hang or produce a truncated
 * file. On success the raw temporary recording is removed; on failure it is
 * deliberately retained (and reported) because it is the only diagnostic
 * material left.
 */
export async function finalizeTutorialVideo(
  options: FinalizeVideoOptions
): Promise<FinalizeVideoResult> {
  const warnings: string[] = [];
  const relativePath = toRunRelativePosixPath(options.runRoot, options.videoPath);

  if (!options.video) {
    return {
      record: {
        kind: "video",
        status: "skipped",
        error: "The tutorial page exposed no recorded video, so no canonical WebM was produced."
      },
      warnings
    };
  }

  let rawPath: string | undefined;
  try {
    rawPath = await options.video.path();
  } catch (error) {
    // Not fatal on its own: saveAs may still work.
    warnings.push(`Raw tutorial video path could not be resolved: ${messageOf(error)}`);
  }

  try {
    await options.video.saveAs(options.videoPath);
  } catch (error) {
    if (rawPath) {
      warnings.push(`Raw tutorial video retained for diagnosis at ${rawPath}.`);
    }
    return {
      record: {
        kind: "video",
        status: "failed",
        path: relativePath,
        error: `Tutorial video could not be finalized to ${relativePath}: ${messageOf(error)}`
      },
      warnings
    };
  }

  const check = await verifyArtifactFile(options.videoPath);
  if (!check.ok) {
    if (rawPath) {
      warnings.push(`Raw tutorial video retained for diagnosis at ${rawPath}.`);
    }
    return {
      record: { kind: "video", status: "failed", path: relativePath, error: check.error },
      warnings
    };
  }

  const cleanupWarning = await removeTemporaryVideoFiles(options.videoTempDir);
  if (cleanupWarning) {
    warnings.push(cleanupWarning);
  }

  return {
    record: { kind: "video", status: "written", path: relativePath, sizeBytes: check.sizeBytes },
    warnings
  };
}

/**
 * Removes raw recordings once the canonical WebM exists, so runs do not
 * accumulate abandoned temporary video directories. Only the dedicated video
 * temp directory is touched, never the canonical artifact.
 */
export async function removeTemporaryVideoFiles(videoTempDir: string): Promise<string | undefined> {
  try {
    const entries = await readdir(videoTempDir);
    await Promise.all(
      entries
        .filter((entry) => entry.toLowerCase().endsWith(".webm"))
        .map((entry) => rm(path.join(videoTempDir, entry), { force: true }))
    );
    return undefined;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      return undefined;
    }
    return `Temporary tutorial video files under ${videoTempDir} could not be removed: ${messageOf(error)}`;
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
