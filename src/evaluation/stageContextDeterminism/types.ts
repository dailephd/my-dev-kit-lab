export interface StageContextDeterminismCandidateV1 {
  runNumber: number;
  value: unknown;
}

export interface StageContextDeterminismRunDigestV1 {
  runNumber: number;
  sha256: string;
}

export interface StageContextDeterminismResultV1 {
  availability: "available" | "unavailable" | "not-applicable";
  repeatCount: number;
  deterministic: boolean | null;
  baselineSha256: string | null;
  runDigests: StageContextDeterminismRunDigestV1[];
  mismatchRunNumbers: number[];
  reason: string | null;
}
