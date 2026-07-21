import { readFile } from "node:fs/promises";
import path from "node:path";
import type { JsonObject, JsonValue } from "./jsonTypes.js";
import type { UpstreamArtifactKind, UpstreamArtifactReadFailure } from "./artifactReadTypes.js";

export interface ReadJsonArtifactFileSuccess {
  ok: true;
  sourcePath: string;
  value: JsonObject;
}

export async function readJsonArtifactFile(
  artifactKind: UpstreamArtifactKind,
  sourcePathInput: string
): Promise<ReadJsonArtifactFileSuccess | UpstreamArtifactReadFailure> {
  const sourcePath = path.resolve(sourcePathInput);

  let raw: string;
  try {
    raw = await readFile(sourcePath, "utf8");
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

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    return {
      ok: false,
      artifactKind,
      sourcePath,
      code: "MALFORMED_JSON",
      message: `Artifact "${artifactKind}" file at "${sourcePath}" is not valid JSON: ${(error as Error).message}`
    };
  }

  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return {
      ok: false,
      artifactKind,
      sourcePath,
      code: "NON_OBJECT_ROOT",
      message: `Artifact "${artifactKind}" file at "${sourcePath}" must parse to a JSON object at the root.`,
      expected: "object",
      actual: parsed as JsonValue
    };
  }

  return { ok: true, sourcePath, value: parsed as JsonObject };
}
