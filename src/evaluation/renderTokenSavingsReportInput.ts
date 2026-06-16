import type { LabReportInput } from "../report/types.js";
import type { TokenSavingsCaseResult, TokenSavingsSummary, TokenSavingsCommandConfig } from "./types.js";

export function renderTokenSavingsReportInput(options: {
  summary: TokenSavingsSummary;
  cases: TokenSavingsCaseResult[];
  commandConfig: TokenSavingsCommandConfig;
  artifactPaths: { summaryPath: string; runsPath: string; htmlPath: string };
  warnings: string[];
}): LabReportInput {
  return {
    reportId: "token-savings-report",
    title: "Token savings evaluation",
    projectName: "my-dev-kit-lab",
    benchmarkProject: "multiple",
    workflowName: "raw full-file context vs my-dev-kit retrieval",
    summary:
      "Estimated token comparison using static context size. Token counts use estimated_chars_div_4. This is not provider billing telemetry, and Codex and Claude telemetry are future work.",
    steps: [
      {
        id: "load-cases",
        label: "Load evaluation cases",
        command: `--cases ${options.commandConfig.casesPath}`,
        status: "pass",
        notes: `${options.summary.caseCount} cases loaded.`
      },
      {
        id: "run-raw-baseline",
        label: "Run raw full-file baseline",
        status: "pass",
        notes: "Collected deterministic full-file context for each benchmark case."
      },
      {
        id: "run-my-dev-kit",
        label: "Run external my-dev-kit retrieval",
        command: options.commandConfig.kitCommand,
        status: options.summary.skippedCaseCount > 0 ? "skipped" : "pass",
        notes: `${options.summary.completedCaseCount} completed, ${options.summary.skippedCaseCount} skipped.`
      }
    ],
    metrics: [
      { id: "token-count-method", label: "Token count method", value: options.summary.tokenCountMethod },
      { id: "case-count", label: "Case count", value: options.summary.caseCount },
      { id: "completed-case-count", label: "Completed case count", value: options.summary.completedCaseCount },
      { id: "skipped-case-count", label: "Skipped case count", value: options.summary.skippedCaseCount },
      { id: "average-raw-tokens", label: "Average raw tokens", value: options.summary.averageRawTokens.toFixed(2) },
      { id: "average-my-dev-kit-tokens", label: "Average my-dev-kit tokens", value: options.summary.averageMyDevKitTokens.toFixed(2) },
      { id: "average-tokens-saved", label: "Average tokens saved", value: options.summary.averageTokensSaved.toFixed(2) },
      { id: "average-percent-saved", label: "Average percent saved", value: options.summary.averagePercentSaved.toFixed(2), unit: "%" },
      { id: "total-commands-run", label: "Total commands run", value: options.summary.totalCommandsRun }
    ],
    artifacts: [
      { id: "summary-json", label: "Token savings summary JSON", path: options.artifactPaths.summaryPath, kind: "json" },
      { id: "runs-json", label: "Token savings runs JSON", path: options.artifactPaths.runsPath, kind: "json" },
      { id: "report-html", label: "Token savings report HTML", path: options.artifactPaths.htmlPath, kind: "html" }
    ],
    warnings: [
      "Token counts are estimated using estimated_chars_div_4.",
      "This is a static context comparison.",
      "This is not provider billing telemetry.",
      "Codex and Claude telemetry are future work.",
      ...options.warnings
    ]
  };
}
