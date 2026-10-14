import type { AgentSuccessPromptSettings } from "./realAgentPrompt.js";

/**
 * Application-level output validation for the real-agent prompt contract. It runs on the final answer text that a
 * provider adapter has ALREADY extracted from its transport (Codex JSONL / Claude result envelope) and before the
 * Lab-owned patch pipeline. It never parses a provider transport envelope and never falls back to legacy extraction
 * for an invalid strict response.
 */
export const STRICT_DIFF_RESPONSE_SCHEMA_VERSION = "1.0.0";
export const STRICT_DIFF_MAX_PATCH_BYTES = 1_048_576;
// Worst case JSON escaping (\u00XX) expands one patch byte to six response bytes, plus the fixed envelope.
const MAX_RESPONSE_BYTES = STRICT_DIFF_MAX_PATCH_BYTES * 6 + 1024;
const MAX_DEPTH = 32;

export type StrictDiffResponseV1 = { schemaVersion: typeof STRICT_DIFF_RESPONSE_SCHEMA_VERSION; patch: string };

export const OUTPUT_CONTRACT_CODES = [
  "STRICT_EMPTY_RESPONSE",
  "STRICT_RESPONSE_TOO_LARGE",
  "STRICT_INVALID_UNICODE",
  "STRICT_MARKDOWN_FENCE",
  "STRICT_NOT_JSON",
  "STRICT_TOO_DEEP",
  "STRICT_DUPLICATE_KEY",
  "STRICT_MULTIPLE_DOCUMENTS",
  "STRICT_TRAILING_CONTENT",
  "STRICT_NOT_OBJECT",
  "STRICT_MISSING_FIELD",
  "STRICT_UNKNOWN_FIELD",
  "STRICT_FIELD_TYPE",
  "STRICT_SCHEMA_VERSION",
  "STRICT_EMPTY_PATCH",
  "STRICT_PATCH_TOO_LARGE",
  "STRICT_PATCH_NOT_RAW_DIFF",
  "EXPLANATION_EMPTY",
  "EXPLANATION_CODE_FENCE",
  "EXPLANATION_PROSE_BEFORE",
  "EXPLANATION_PROSE_IN_DIFF",
  "EXPLANATION_MALFORMED_DIFF"
] as const;
export type OutputContractCode = (typeof OUTPUT_CONTRACT_CODES)[number];

export type AgentOutputValidation =
  | { ok: true; /** Text handed to the existing patch pipeline: the original answer (legacy) or the decoded patch (strict). */ patchText: string }
  | { ok: false; code: OutputContractCode };

class JsonProblem extends Error {
  constructor(readonly code: OutputContractCode) {
    super(code);
  }
}

type JsonValue = null | boolean | number | string | JsonValue[] | Map<string, JsonValue>;

const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
const isWellFormedUnicode = (value: string): boolean => !LONE_SURROGATE.test(value);
const isWhitespace = (char: string): boolean => char === " " || char === "\t" || char === "\n" || char === "\r";

/** Small bounded RFC 8259 parser. It exists because JSON.parse silently keeps the last of duplicate object keys. */
function parseJsonStrict(text: string): { value: JsonValue; end: number } {
  let index = 0;
  const skip = (): void => {
    while (index < text.length && isWhitespace(text[index]!)) index += 1;
  };
  const bad = (): never => {
    throw new JsonProblem("STRICT_NOT_JSON");
  };
  const parseString = (): string => {
    index += 1; // opening quote
    let out = "";
    for (;;) {
      if (index >= text.length) bad();
      const char = text[index]!;
      if (char === '"') {
        index += 1;
        return out;
      }
      if (char.charCodeAt(0) < 0x20) bad();
      if (char === "\\") {
        const next = text[index + 1];
        index += 2;
        switch (next) {
          case '"': out += '"'; break;
          case "\\": out += "\\"; break;
          case "/": out += "/"; break;
          case "b": out += "\b"; break;
          case "f": out += "\f"; break;
          case "n": out += "\n"; break;
          case "r": out += "\r"; break;
          case "t": out += "\t"; break;
          case "u": {
            const hex = text.slice(index, index + 4);
            if (!/^[0-9a-fA-F]{4}$/.test(hex)) bad();
            out += String.fromCharCode(parseInt(hex, 16));
            index += 4;
            break;
          }
          default:
            bad();
        }
        continue;
      }
      out += char;
      index += 1;
    }
  };
  const parseValue = (depth: number): JsonValue => {
    if (depth > MAX_DEPTH) throw new JsonProblem("STRICT_TOO_DEEP");
    skip();
    const char = text[index];
    if (char === undefined) return bad();
    if (char === "{") {
      index += 1;
      const object = new Map<string, JsonValue>();
      skip();
      if (text[index] === "}") {
        index += 1;
        return object;
      }
      for (;;) {
        skip();
        if (text[index] !== '"') bad();
        const key = parseString();
        if (object.has(key)) throw new JsonProblem("STRICT_DUPLICATE_KEY");
        skip();
        if (text[index] !== ":") bad();
        index += 1;
        object.set(key, parseValue(depth + 1));
        skip();
        if (text[index] === ",") {
          index += 1;
          continue;
        }
        if (text[index] === "}") {
          index += 1;
          return object;
        }
        bad();
      }
    }
    if (char === "[") {
      index += 1;
      const array: JsonValue[] = [];
      skip();
      if (text[index] === "]") {
        index += 1;
        return array;
      }
      for (;;) {
        array.push(parseValue(depth + 1));
        skip();
        if (text[index] === ",") {
          index += 1;
          continue;
        }
        if (text[index] === "]") {
          index += 1;
          return array;
        }
        bad();
      }
    }
    if (char === '"') return parseString();
    for (const [literal, value] of [["true", true], ["false", false], ["null", null]] as const) {
      if (text.startsWith(literal, index)) {
        index += literal.length;
        return value;
      }
    }
    const number = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(text.slice(index, index + 64));
    if (number) {
      index += number[0].length;
      return Number(number[0]);
    }
    return bad();
  };
  const value = parseValue(0);
  skip();
  return { value, end: index };
}

const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;
const HEADER_PREFIXES = [
  "diff --git ", "index ", "--- ", "+++ ", "new file mode ", "deleted file mode ", "old mode ", "new mode ",
  "similarity index ", "dissimilarity index ", "rename from ", "rename to ", "copy from ", "copy to ", "Binary files "
];

/**
 * Raw-diff-only grammar check: every line must be a git diff header, a hunk header, or a hunk body line whose count
 * is consumed exactly by the preceding hunk header. Prose before, between or after the diff is a violation.
 */
function checkRawDiffOnly(text: string): OutputContractCode | null {
  if (text.trim() === "") return "EXPLANATION_EMPTY";
  if (/^[ \t]*```/m.test(text)) return "EXPLANATION_CODE_FENCE";
  const trimmed = text.trimStart();
  if (!trimmed.startsWith("diff --git ") && !trimmed.startsWith("--- ")) return "EXPLANATION_PROSE_BEFORE";
  const lines = trimmed.split(/\r?\n/);
  while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  let oldRemaining = 0;
  let newRemaining = 0;
  for (const line of lines) {
    if (oldRemaining > 0 || newRemaining > 0) {
      if (line.startsWith("\\")) continue;
      const marker = line.length === 0 ? " " : line[0]!;
      if (marker === " ") { oldRemaining -= 1; newRemaining -= 1; }
      else if (marker === "-") oldRemaining -= 1;
      else if (marker === "+") newRemaining -= 1;
      else return "EXPLANATION_PROSE_IN_DIFF";
      if (oldRemaining < 0 || newRemaining < 0) return "EXPLANATION_PROSE_IN_DIFF";
      continue;
    }
    if (line.startsWith("\\")) continue;
    const hunk = HUNK_HEADER.exec(line);
    if (hunk) {
      oldRemaining = hunk[2] === undefined ? 1 : Number(hunk[2]);
      newRemaining = hunk[4] === undefined ? 1 : Number(hunk[4]);
      continue;
    }
    if (HEADER_PREFIXES.some((prefix) => line.startsWith(prefix))) continue;
    return "EXPLANATION_PROSE_IN_DIFF";
  }
  return oldRemaining === 0 && newRemaining === 0 ? null : "EXPLANATION_MALFORMED_DIFF";
}

/** Validates one strict-diff-v1 final answer. Returns the decoded patch only for an exactly-conforming response. */
export function parseStrictDiffResponse(text: string): { ok: true; response: StrictDiffResponseV1 } | { ok: false; code: OutputContractCode } {
  if (typeof text !== "string" || text.trim() === "") return { ok: false, code: "STRICT_EMPTY_RESPONSE" };
  if (Buffer.byteLength(text, "utf8") > MAX_RESPONSE_BYTES) return { ok: false, code: "STRICT_RESPONSE_TOO_LARGE" };
  if (!isWellFormedUnicode(text)) return { ok: false, code: "STRICT_INVALID_UNICODE" };
  if (/^\s*```/.test(text)) return { ok: false, code: "STRICT_MARKDOWN_FENCE" };
  let parsed: { value: JsonValue; end: number };
  try {
    parsed = parseJsonStrict(text);
  } catch (error) {
    return { ok: false, code: error instanceof JsonProblem ? error.code : "STRICT_NOT_JSON" };
  }
  const rest = text.slice(parsed.end);
  if (rest !== "") {
    const next = rest.trimStart()[0];
    return { ok: false, code: next === "{" || next === "[" ? "STRICT_MULTIPLE_DOCUMENTS" : "STRICT_TRAILING_CONTENT" };
  }
  const value = parsed.value;
  if (!(value instanceof Map)) return { ok: false, code: "STRICT_NOT_OBJECT" };
  for (const key of value.keys()) {
    if (key !== "schemaVersion" && key !== "patch") return { ok: false, code: "STRICT_UNKNOWN_FIELD" };
  }
  if (!value.has("schemaVersion") || !value.has("patch")) return { ok: false, code: "STRICT_MISSING_FIELD" };
  const schemaVersion = value.get("schemaVersion");
  const patch = value.get("patch");
  if (typeof schemaVersion !== "string" || typeof patch !== "string") return { ok: false, code: "STRICT_FIELD_TYPE" };
  if (schemaVersion !== STRICT_DIFF_RESPONSE_SCHEMA_VERSION) return { ok: false, code: "STRICT_SCHEMA_VERSION" };
  if (!isWellFormedUnicode(patch)) return { ok: false, code: "STRICT_INVALID_UNICODE" };
  if (patch.trim() === "") return { ok: false, code: "STRICT_EMPTY_PATCH" };
  if (Buffer.byteLength(patch, "utf8") > STRICT_DIFF_MAX_PATCH_BYTES) return { ok: false, code: "STRICT_PATCH_TOO_LARGE" };
  if (checkRawDiffOnly(patch) !== null) return { ok: false, code: "STRICT_PATCH_NOT_RAW_DIFF" };
  return { ok: true, response: { schemaVersion: STRICT_DIFF_RESPONSE_SCHEMA_VERSION, patch } };
}

/**
 * Applies the effective output contract to an extracted provider final answer.
 *  - strict-diff-v1: exactly StrictDiffResponseV1; the decoded patch is returned.
 *  - legacy-diff-v1 + explanationMode none: a raw unified diff with no fence or prose; the text is returned unchanged.
 *  - legacy-diff-v1 + explanationMode legacy: historical behavior, text returned unchanged.
 */
export function validateAgentSuccessFinalAnswer(
  settings: Pick<AgentSuccessPromptSettings, "templateId" | "explanationMode">,
  finalAnswerText: string
): AgentOutputValidation {
  if (settings.templateId === "strict-diff-v1") {
    const parsed = parseStrictDiffResponse(finalAnswerText);
    return parsed.ok ? { ok: true, patchText: parsed.response.patch } : { ok: false, code: parsed.code };
  }
  if (settings.explanationMode === "none") {
    const violation = checkRawDiffOnly(finalAnswerText);
    return violation === null ? { ok: true, patchText: finalAnswerText } : { ok: false, code: violation };
  }
  return { ok: true, patchText: finalAnswerText };
}
