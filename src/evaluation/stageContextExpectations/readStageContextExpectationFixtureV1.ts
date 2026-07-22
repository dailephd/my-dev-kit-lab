import { readFile } from "node:fs/promises";
import path from "node:path";
import type { JsonObject, JsonValue } from "../upstreamArtifacts/index.js";
import type { StageContextExpectationReadResult } from "./readTypes.js";
import { validateStageContextExpectationFixtureV1 } from "./validation.js";

export async function readStageContextExpectationFixtureV1(
  sourcePathInput: string
): Promise<StageContextExpectationReadResult> {
  const sourcePath = path.resolve(sourcePathInput);

  let raw: string;
  try {
    raw = await readFile(sourcePath, "utf8");
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      return {
        ok: false,
        sourcePath,
        code: "FILE_NOT_FOUND",
        message: `Stage context expectation fixture was not found at "${sourcePath}".`
      };
    }
    return {
      ok: false,
      sourcePath,
      code: "UNREADABLE_FILE",
      message: `Stage context expectation fixture at "${sourcePath}" could not be read: ${(error as Error).message}`
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    return {
      ok: false,
      sourcePath,
      code: "MALFORMED_JSON",
      message: `Stage context expectation fixture at "${sourcePath}" is not valid JSON: ${(error as Error).message}`
    };
  }

  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return {
      ok: false,
      sourcePath,
      code: "NON_OBJECT_ROOT",
      message: `Stage context expectation fixture at "${sourcePath}" must parse to a JSON object at the root.`,
      expected: "object",
      actual: parsed as JsonValue
    };
  }

  return validateStageContextExpectationFixtureV1(parsed as JsonObject, sourcePath);
}
