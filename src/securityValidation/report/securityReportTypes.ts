import type { ReleaseVerdict, SecurityCheckResult, SecurityFinding } from "../types.js";

export type SecurityReportMetadata = {
  packageName: string;
  packageVersion: string;
  branch: string;
  commit: string;
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
