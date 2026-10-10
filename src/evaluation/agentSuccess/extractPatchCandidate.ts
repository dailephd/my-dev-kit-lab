import { DEFAULT_PATCH_BOUNDS, type PatchBounds, type PatchExtractionResult } from "./patchTypes.js";

const FENCED_DIFF_BLOCK = /^```[ \t]*(?:diff|patch)[ \t]*\r?\n([\s\S]*?)^```[ \t]*$/gim;

function looksLikeDiffStart(text: string): boolean {
  return text.startsWith("diff --git ") || text.startsWith("--- ");
}

/** Removes trailing line breaks only: a final context line that is a single space must survive. */
function finalize(body: string): string {
  return `${body.replace(/(?:\r?\n)+$/, "")}\n`;
}

/**
 * Extracts exactly one patch candidate from an agent's proposal: either one fenced `diff`/`patch` block, or
 * the whole (trimmed) text when it is itself a unified diff. Ambiguity is rejected rather than guessed.
 * Size and line bounds are enforced before any parsing.
 */
export function extractPatchCandidate(text: unknown, bounds: Readonly<PatchBounds> = DEFAULT_PATCH_BOUNDS): PatchExtractionResult {
  if (typeof text !== "string" || text.trim() === "") {
    return { ok: false, code: "EMPTY", message: "the proposal is empty." };
  }
  if (Buffer.byteLength(text, "utf8") > bounds.maxPatchBytes) {
    return { ok: false, code: "PATCH_TOO_LARGE", message: `the proposal exceeds ${bounds.maxPatchBytes} bytes.` };
  }
  if (text.split("\n").length > bounds.maxPatchLines) {
    return { ok: false, code: "PATCH_TOO_MANY_LINES", message: `the proposal exceeds ${bounds.maxPatchLines} lines.` };
  }

  const fenced = [...text.matchAll(FENCED_DIFF_BLOCK)];
  if (fenced.length > 1) {
    return { ok: false, code: "AMBIGUOUS_CANDIDATES", message: "more than one fenced diff/patch block was found." };
  }
  if (fenced.length === 1) {
    const match = fenced[0]!;
    const outside = text.slice(0, match.index) + text.slice((match.index ?? 0) + match[0].length);
    if (/^diff --git /m.test(outside)) {
      return { ok: false, code: "AMBIGUOUS_CANDIDATES", message: "a fenced block and a raw diff were both present." };
    }
    const body = match[1] ?? "";
    if (body.trim() === "") {
      return { ok: false, code: "EMPTY", message: "the fenced diff block is empty." };
    }
    return { ok: true, patch: finalize(body) };
  }

  const trimmed = text.trimStart();
  if (looksLikeDiffStart(trimmed)) {
    return { ok: true, patch: finalize(trimmed) };
  }
  return { ok: false, code: "NO_CANDIDATE", message: "no fenced diff/patch block and no raw unified diff was found." };
}
