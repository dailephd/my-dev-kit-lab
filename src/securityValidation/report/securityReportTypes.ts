import type { ReleaseVerdict, SecurityCheckResult, SecurityFinding } from "../types.js";

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
};
