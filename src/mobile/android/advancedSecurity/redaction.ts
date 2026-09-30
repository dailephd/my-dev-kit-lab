import { createHash, scryptSync } from "node:crypto";
import path from "node:path";
import { stripUnsafeControlChars } from "../../../securityValidation/attackScenarios/exploitEvidence.js";

// ---------------------------------------------------------------------------
// v0.4.1 Batch 1 — redaction and fingerprint primitives for later Android
// secret/signing/configuration candidate evidence.
//
// Reuses stripUnsafeControlChars from the existing exploit-evidence redaction
// owner (src/securityValidation/attackScenarios/exploitEvidence.ts) rather
// than re-implementing control-character stripping. That module's
// redactPreview() fully masks any secret-*looking* substring behind a
// "[REDACTED:Nchars]" marker with no prefix/suffix, which is the right
// behavior for exploit-scenario evidence (never show any of a real exploit
// payload). Android candidate evidence has a different, narrower need: a
// human reviewing a static-candidate finding benefits from a short prefix/
// suffix so they can recognize *which* secret in their own source it is
// without retaining the full value — so this module adds that
// prefix/suffix-preserving preview and a one-way fingerprint on
// top of the shared control-character stripping, instead of creating a
// second, competing full-redaction implementation.
// ---------------------------------------------------------------------------

const DEFAULT_MAX_PREVIEW_LENGTH = 64;
const DEFAULT_EDGE_LENGTH = 3;
const MASK = "***";

export type RedactedPreviewInput = string | undefined;

// Distinguishes "no input was available to redact" (e.g. a value could not
// be read) from "the input was an empty string literal" — callers must not
// conflate the two.
export function redactedPreviewForCandidate(
  input: RedactedPreviewInput,
  options: { maxLength?: number; edgeLength?: number } = {}
): string {
  if (input === undefined) return "[unavailable]";
  if (input.length === 0) return "[empty]";

  const maxLength = options.maxLength ?? DEFAULT_MAX_PREVIEW_LENGTH;
  const edgeLength = options.edgeLength ?? DEFAULT_EDGE_LENGTH;

  const normalized = stripUnsafeControlChars(input).replace(/\r\n|\r|\n/g, "\\n");
  const bounded = normalized.length > maxLength ? `${normalized.slice(0, maxLength)}...` : normalized;

  // Too short to safely show both a prefix and a suffix without
  // reconstructing most or all of the value — mask it entirely instead.
  if (bounded.length <= edgeLength * 2) {
    return MASK;
  }

  const prefix = bounded.slice(0, edgeLength);
  const suffix = bounded.slice(-edgeLength);
  return `${prefix}${MASK}${suffix}`;
}

export type CandidateFingerprintContext = {
  ruleId: string;
  sourcePath: string;
  line?: number;
  column?: number;
  purpose: string;
};

// Deterministic, one-way evidence identity. Scrypt makes guessing more costly
// than a fast hash, but low-entropy values are not cryptographically
// unrecoverable. The context salt separates equivalent values at distinct
// evidence locations without storing a secret salt or the raw value.
export function fingerprintCandidateValue(input: RedactedPreviewInput, context: CandidateFingerprintContext): string {
  if (input === undefined) return "unavailable";
  const contextSalt = createHash("sha256")
    .update(JSON.stringify([
      "my-dev-kit-lab/android-candidate-fingerprint/v2",
      context.ruleId,
      path.posix.normalize(context.sourcePath.replaceAll("\\", "/")),
      context.line ?? null,
      context.column ?? null,
      context.purpose
    ]), "utf8")
    .digest();
  const derived = scryptSync(input, contextSalt, 32, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  return `scrypt-v1:${derived.toString("hex")}`;
}
