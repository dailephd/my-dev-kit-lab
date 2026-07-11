import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { relativeWithinRoot, resolveWithinRoot } from "../../../../core/pathSafety.js";
import type { AndroidExternalSecurityToolId, AndroidExternalToolArtifactKind, AndroidExternalToolArtifactReference } from "./types.js";

// ---------------------------------------------------------------------------
// v0.4.1 Batch 7 — bounded, contained artifact handling for raw external-tool
// output. New infrastructure: no existing owner copies/hashes generated
// Gradle or external-tool output (confirmed absent from
// src/mobile/android/gradle/validate/*). Reuses src/core/pathSafety.ts for
// containment rather than a second path-safety implementation.
// ---------------------------------------------------------------------------

const MAX_ARTIFACT_BYTES = 32 * 1024 * 1024;

function mediaTypeFor(kind: AndroidExternalToolArtifactKind): string {
  switch (kind) {
    case "json":
      return "application/json";
    case "xml":
      return "application/xml";
    case "sarif":
      return "application/sarif+json";
    case "text":
      return "text/plain";
  }
}

function sha256Of(buffer: Buffer): string {
  return `sha256:${createHash("sha256").update(buffer).digest("hex")}`;
}

function toolArtifactDir(artifactRoot: string, toolId: AndroidExternalSecurityToolId): string {
  return resolveWithinRoot(path.resolve(artifactRoot), toolId);
}

// Writes tool-generated content (e.g. a materialized Semgrep config, or
// content the adapter itself produced) under `<artifactRoot>/<toolId>/`.
// Containment is validated by resolveWithinRoot, which throws on traversal —
// callers must not catch that away.
export function writeExternalToolArtifact(
  artifactRoot: string,
  toolId: AndroidExternalSecurityToolId,
  fileName: string,
  content: string,
  kind: AndroidExternalToolArtifactKind
): AndroidExternalToolArtifactReference {
  const dir = toolArtifactDir(artifactRoot, toolId);
  fs.mkdirSync(dir, { recursive: true });
  const absolutePath = resolveWithinRoot(dir, fileName);
  const buffer = Buffer.from(content, "utf8");
  const truncated = buffer.byteLength > MAX_ARTIFACT_BYTES;
  const boundedBuffer = truncated ? buffer.subarray(0, MAX_ARTIFACT_BYTES) : buffer;
  fs.writeFileSync(absolutePath, boundedBuffer);

  return {
    toolId,
    artifactKind: kind,
    relativePath: relativeWithinRoot(path.resolve(artifactRoot), absolutePath),
    mediaType: mediaTypeFor(kind),
    sizeBytes: boundedBuffer.byteLength,
    sha256: sha256Of(boundedBuffer),
    generatedByThisRun: true,
    copiedFromTarget: false,
    truncated,
    parseStatus: "not-attempted",
  };
}

// Copies an existing target-generated report (e.g. a fresh Android Lint XML
// file) into the artifact root without modifying or deleting the original.
export function copyExternalToolArtifactFromTarget(
  artifactRoot: string,
  targetRoot: string,
  toolId: AndroidExternalSecurityToolId,
  sourceAbsolutePath: string,
  kind: AndroidExternalToolArtifactKind
): AndroidExternalToolArtifactReference | undefined {
  let stat: fs.Stats;
  try {
    stat = fs.statSync(sourceAbsolutePath);
  } catch {
    return undefined;
  }
  if (!stat.isFile()) return undefined;

  const truncated = stat.size > MAX_ARTIFACT_BYTES;
  const buffer = truncated ? fs.readFileSync(sourceAbsolutePath).subarray(0, MAX_ARTIFACT_BYTES) : fs.readFileSync(sourceAbsolutePath);

  const dir = toolArtifactDir(artifactRoot, toolId);
  fs.mkdirSync(dir, { recursive: true });
  const destFileName = path.basename(sourceAbsolutePath);
  const destAbsolutePath = resolveWithinRoot(dir, destFileName);
  fs.writeFileSync(destAbsolutePath, buffer);

  let sourceTargetRelativePath: string | undefined;
  try {
    sourceTargetRelativePath = relativeWithinRoot(path.resolve(targetRoot), sourceAbsolutePath);
  } catch {
    sourceTargetRelativePath = undefined;
  }

  return {
    toolId,
    artifactKind: kind,
    relativePath: relativeWithinRoot(path.resolve(artifactRoot), destAbsolutePath),
    mediaType: mediaTypeFor(kind),
    sizeBytes: buffer.byteLength,
    sha256: sha256Of(buffer),
    generatedByThisRun: true,
    copiedFromTarget: true,
    sourceTargetRelativePath,
    truncated,
    parseStatus: "not-attempted",
  };
}
