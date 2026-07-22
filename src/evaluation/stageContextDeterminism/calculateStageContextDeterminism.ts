import { createHash } from "node:crypto";
import { canonicalizeStageContextRun } from "./canonicalizeStageContextRun.js";
import type {
  StageContextDeterminismCandidateV1,
  StageContextDeterminismResultV1,
  StageContextDeterminismRunDigestV1
} from "./types.js";

function sha256Hex(text: string): string {
  return createHash("sha256").update(Buffer.from(text, "utf8")).digest("hex");
}

export function calculateStageContextDeterminism(
  candidates: readonly StageContextDeterminismCandidateV1[]
): StageContextDeterminismResultV1 {
  if (candidates.length === 0) {
    throw new Error("calculateStageContextDeterminism requires at least one candidate.");
  }

  if (candidates.length === 1) {
    return {
      availability: "not-applicable",
      repeatCount: 1,
      deterministic: null,
      baselineSha256: null,
      runDigests: [],
      mismatchRunNumbers: [],
      reason: "Repeated-run determinism requires at least two runs."
    };
  }

  let runDigests: StageContextDeterminismRunDigestV1[];
  try {
    runDigests = candidates.map((candidate) => ({
      runNumber: candidate.runNumber,
      sha256: sha256Hex(canonicalizeStageContextRun(candidate.value))
    }));
  } catch {
    return {
      availability: "unavailable",
      repeatCount: candidates.length,
      deterministic: null,
      baselineSha256: null,
      runDigests: [],
      mismatchRunNumbers: [],
      reason: "Stage-context run values could not be canonicalized for determinism comparison."
    };
  }

  const baselineSha256 = runDigests[0].sha256;
  const mismatchRunNumbers = runDigests
    .filter((digest) => digest.sha256 !== baselineSha256)
    .map((digest) => digest.runNumber);

  return {
    availability: "available",
    repeatCount: candidates.length,
    deterministic: mismatchRunNumbers.length === 0,
    baselineSha256,
    runDigests,
    mismatchRunNumbers,
    reason: null
  };
}
