import type { ReleaseVerdict, SecurityCheckResult, SecurityFinding } from "../types.js";
import type { AttackResult } from "../attackScenarios/attackResult.js";
import type { VerdictReasonSummary } from "../validate/verdict.js";

export type SecurityReportMetadata = {
  // Tool identity (my-dev-kit-lab running the validation)
  toolRoot: string;
  toolPackageName: string;
  toolPackageVersion: string;
  // Target project being validated
  targetRoot: string;
  targetDescription: string;
  packageName: string;
  packageVersion: string;
  branch: string;
  commit: string;
  isSelf: boolean;
  generatedAt: string;
  totalDurationMs: number;
  // v0.2.2 Batch 1 config surface — optional so existing report construction
  // and tests that omit them remain valid.
  profile?: string;
  selectedChecks?: string[];
  failOnThreshold?: string;
  formats?: string[];
  // v0.2.2 Batch 5 — additive verdict-policy/fail-on fields.
  failOnBreached?: boolean;
  isFullReleaseGate?: boolean;
};

export type SecurityReportSection = {
  sectionNumber: number;
  title: string;
  checkId?: string;
  status: string;
  summary: string;
  findings: SecurityFinding[];
  skippedReason?: string;
};

export type SecurityReport = {
  metadata: SecurityReportMetadata;
  sections: SecurityReportSection[];
  allChecks: SecurityCheckResult[];
  allFindings: SecurityFinding[];
  verdict: ReleaseVerdict;
  recommendedNextStep: string;
  // v0.2.2 Batch 2 — optional so existing report construction/tests that
  // omit it remain valid. Empty/omitted means no attack-scenario-shaped
  // checks were selected for this run.
  attackResults?: AttackResult[];
  // v0.2.2 Batch 5 — additive verdict-reasoning summary (category counts).
  verdictReasonSummary?: VerdictReasonSummary;
};
