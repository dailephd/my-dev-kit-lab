import { readFile } from "node:fs/promises";
import path from "node:path";
import type { UpstreamArtifactKind, UpstreamArtifactReadFailure } from "./artifactReadTypes.js";

export interface ReadTextArtifactFileSuccess {
  ok: true;
  sourcePath: string;
  text: string;
}

export async function readTextArtifactFile(
  artifactKind: UpstreamArtifactKind,
  sourcePathInput: string
): Promise<ReadTextArtifactFileSuccess | UpstreamArtifactReadFailure> {
  const sourcePath = path.resolve(sourcePathInput);

  let text: string;
  try {
    text = await readFile(sourcePath, "utf8");
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      return {
        ok: false,
        artifactKind,
        sourcePath,
        code: "FILE_NOT_FOUND",
        message: `Artifact "${artifactKind}" file was not found at "${sourcePath}".`
      };
    }
    return {
      ok: false,
      artifactKind,
      sourcePath,
      code: "UNREADABLE_FILE",
      message: `Artifact "${artifactKind}" file at "${sourcePath}" could not be read: ${(error as Error).message}`
    };
  }

  return { ok: true, sourcePath, text };
}
