import type { ExperimentComparison, ExperimentRun } from "../evaluation/controlledExperimentTypes.js";
import type { ExperimentReportInput } from "./experimentReportTypes.js";

export function renderExperimentHtmlReport(report: ExperimentReportInput): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(report.title)}</title>
  <style>
    :root { color-scheme: light; font-family: Arial, Helvetica, sans-serif; }
    body { margin: 0; color: #17212b; background: #f5f7fa; }
    main { max-width: 1180px; margin: 0 auto; padding: 28px; }
    h1 { font-size: 34px; margin: 0 0 8px; }
    h2 { font-size: 24px; margin: 0 0 14px; }
    h3 { font-size: 18px; margin: 18px 0 8px; }
    p, li { line-height: 1.45; }
    code, pre { font-family: Consolas, "Courier New", monospace; }
    pre { white-space: pre-wrap; word-break: break-word; background: #101820; color: #f4f7fb; padding: 14px; border-radius: 6px; overflow: auto; }
    table { width: 100%; border-collapse: collapse; margin: 10px 0 18px; background: #fff; }
    th, td { border: 1px solid #d9e1ea; padding: 8px 10px; text-align: left; vertical-align: top; }
    th { background: #edf2f7; }
    .hero, section { background: #fff; border: 1px solid #d7e0ea; border-radius: 8px; padding: 20px; margin-bottom: 18px; }
    .muted { color: #5b6b7b; }
    .grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; }
    .card { border: 1px solid #d9e1ea; border-radius: 6px; padding: 12px; background: #fbfcfe; }
    .metric { font-size: 26px; font-weight: 700; margin-top: 6px; }
    .badge { display: inline-block; border-radius: 999px; padding: 3px 9px; font-size: 12px; font-weight: 700; text-transform: uppercase; background: #e8eef7; }
    .status-completed, .answer-yes, .status-pass { background: #dcf4e4; color: #0c6b30; }
    .status-failed, .status-invalid-output, .answer-no, .status-fail { background: #fde2e2; color: #8a1f1f; }
    .status-timeout, .status-agent-limit-reached, .answer-mixed { background: #fff0ce; color: #785400; }
    .status-agent-unavailable, .status-skipped, .answer-unavailable, .answer-inconclusive { background: #ece8ff; color: #5639a8; }
    .two { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; }
    .small { font-size: 13px; }
    @media (max-width: 900px) { main { padding: 16px; } .grid, .two { grid-template-columns: 1fr; } table { font-size: 13px; } }
  </style>
</head>
<body>
<main>
  <header class="hero">
    <h1>${escapeHtml(report.title)}</h1>
    <p>${escapeHtml(report.subtitle)}</p>
    <p class="muted">Generated ${escapeHtml(report.generatedAt)} from <code>${escapeHtml(report.sourceExperimentDir)}</code></p>
  </header>

  <section id="executive-summary">
    <h2>Executive Summary</h2>
    <p>${escapeHtml(report.executiveSummary.summaryText)}</p>
    <div class="grid">
      ${answerCard("Does my-dev-kit save tokens?", report.executiveSummary.doesMyDevKitSaveTokens)}
      ${answerCard("Does my-dev-kit preserve correctness?", report.executiveSummary.doesMyDevKitPreserveCorrectness)}
      ${answerCard("Does my-dev-kit reduce execution time?", report.executiveSummary.doesMyDevKitReduceExecutionTime)}
    </div>
    <div class="grid">
      ${metricCard("Completed runs", report.executiveSummary.completedRuns)}
      ${metricCard("Failed runs", report.executiveSummary.failedRuns)}
      ${metricCard("Unavailable runs", report.executiveSummary.unavailableRuns)}
      ${metricCard("External limits", report.executiveSummary.limitReachedRuns)}
      ${metricCard("Timeouts", report.executiveSummary.timeoutRuns)}
      ${metricCard("Invalid output", report.executiveSummary.invalidOutputRuns)}
    </div>
    <h3>Comparison Reliability</h3>
    ${keyValueTable(report.executiveSummary.comparisonReliabilityCounts)}
  </section>

  <section id="methodology">
    <h2>Methodology</h2>
    ${list(report.methodology)}
  </section>

  <section id="projects">
    <h2>Benchmark Projects</h2>
    ${report.projectProfiles.map(renderProject).join("")}
  </section>

  <section id="file-trees">
    <h2>File Trees</h2>
    ${report.fileTreeSections.map(renderFileTree).join("")}
  </section>

  <section id="benchmark-tasks">
    <h2>Benchmark Tasks</h2>
    ${report.benchmarkCases.map(renderBenchmarkCase).join("")}
  </section>

  <section id="prompts">
    <h2>Prompt Strategies</h2>
    ${report.promptComparisonSections.map(renderPrompt).join("")}
  </section>

  <section id="agent-runs">
    <h2>Agent Runs</h2>
    ${renderRuns(report.agentRunSections)}
  </section>

  <section id="correctness">
    <h2>Correctness Results</h2>
    ${renderCorrectness(report.correctnessSections)}
  </section>

  <section id="tokens">
    <h2>Token Results</h2>
    ${renderTokenComparisons(report.tokenSections)}
  </section>

  <section id="timing">
    <h2>Timing Results</h2>
    ${renderTimingComparisons(report.timingSections)}
  </section>

  <section id="comparisons">
    <h2>Raw vs my-dev-kit Comparisons</h2>
    ${renderComparisons(report.comparisonSections)}
  </section>

  <section id="formulas">
    <h2>Formulas</h2>
    ${report.formulaSections
      .map((section) => `<div class="card"><h3>${escapeHtml(section.title)}</h3><pre>${escapeHtml(section.formula)}</pre>${list(section.notes)}</div>`)
      .join("")}
  </section>

  <section id="warnings">
    <h2>Warnings and Limitations</h2>
    <h3>Warnings</h3>
    ${report.warnings.length ? list(report.warnings) : "<p>No warnings.</p>"}
    <h3>Limitations</h3>
    ${list(report.limitations)}
  </section>

  <section id="artifacts">
    <h2>Artifact Index</h2>
    ${table(["Label", "Kind", "Path"], report.artifactLinks.map((artifact) => [artifact.label, artifact.kind, artifact.path]))}
  </section>

  <section id="next-steps">
    <h2>Next Steps</h2>
    ${list(report.nextSteps)}
  </section>
</main>
</body>
</html>`;
}

function renderProject(section: ExperimentReportInput["projectProfiles"][number]): string {
  const profile = section.profile;
  return `<div class="card">
    <h3>${escapeHtml(profile.displayName)} <span class="muted">(${escapeHtml(profile.projectId)})</span></h3>
    <p>${escapeHtml(profile.description)}</p>
    ${table(
      ["Field", "Value"],
      [
        ["Primary language", profile.primaryLanguage],
        ["Languages", profile.languages.join(", ")],
        ["Language mix", profile.languageMix],
        ["Benchmark purpose", profile.benchmarkPurpose],
        ["Expected use cases", profile.expectedUseCases.join(", ")],
        ["Complexity level", profile.complexityLevel],
        ["Complexity score", String(profile.complexityScore)],
        ["Complexity formula", profile.complexityFormula.id]
      ]
    )}
    <h3>Complexity Metrics</h3>
    ${keyValueTable(section.complexityMetrics)}
  </div>`;
}

function renderFileTree(section: ExperimentReportInput["fileTreeSections"][number]): string {
  return `<div class="card">
    <h3>${escapeHtml(section.projectId)}</h3>
    ${table(
      ["Path", "Role", "Language", "Lines"],
      section.entries.map((entry) => [entry.path, entry.role, entry.language ?? "", entry.lines === undefined ? "" : String(entry.lines)])
    )}
    ${section.truncated ? `<p class="muted">Showing ${section.entries.length} of ${section.totalEntries} entries.</p>` : ""}
  </div>`;
}

function renderBenchmarkCase(section: ExperimentReportInput["benchmarkCases"][number]): string {
  return `<div class="card">
    <h3>${escapeHtml(section.title)} <span class="muted">(${escapeHtml(section.caseId)})</span></h3>
    ${table(
      ["Field", "Value"],
      [
        ["Benchmark project", section.benchmarkProject],
        ["Task/query", section.query],
        ["Expected operation", section.expectedOperation ?? ""],
        ["Expected files", section.expectedFiles.join(", ")],
        ["Expected symbols", section.expectedSymbols.join(", ")],
        ["Minimum correct facts", String(section.minimumCorrectFacts)],
        ["Notes", section.notes ?? ""]
      ]
    )}
    <h3>Expected Facts Summary</h3>
    ${table(["ID", "Required", "Weight", "Text"], section.expectedFacts.map((fact) => [fact.id, String(fact.required), String(fact.weight), fact.text]))}
  </div>`;
}

function renderPrompt(section: ExperimentReportInput["promptComparisonSections"][number]): string {
  return `<details class="card" open>
    <summary><strong>${escapeHtml(section.strategy)}</strong> ${escapeHtml(section.complexityLevel)} for ${escapeHtml(section.agentId)}</summary>
    ${table(
      ["Metric", "Value"],
      [
        ["Run ID", section.runId],
        ["Prompt path", section.promptPath ?? ""],
        ["Prompt estimated tokens", String(section.metrics.promptEstimatedTokens)],
        ["Prompt chars", String(section.metrics.promptChars)],
        ["Instruction count", String(section.metrics.instructionCount)],
        ["Constraint count", String(section.metrics.constraintCount)],
        ["Requested output fields", String(section.metrics.requestedOutputFieldCount)],
        ["Graph-guided retrieval required", String(section.metrics.requiresGraphGuidedRetrieval)],
        ["Command execution required", String(section.metrics.requiresCommandExecution)]
      ]
    )}
    <pre>${escapeHtml(section.promptExcerpt)}</pre>
    ${section.promptWasTruncated ? "<p class=\"muted\">Prompt excerpt truncated; see artifact path for full prompt.</p>" : ""}
  </details>`;
}

function renderRuns(runs: ExperimentRun[]): string {
  return table(
    ["Run ID", "Agent", "Strategy", "Complexity", "Status", "Reason", "Duration", "Exit", "Tokens", "Token Source", "Correctness", "Artifacts"],
    runs.map((run) => [
      run.runId,
      run.agentId,
      run.promptStrategy,
      run.promptComplexityLevel,
      run.status,
      run.statusReason,
      `${run.durationMs} ms`,
      run.agentRunResult.exitCode === null ? "" : String(run.agentRunResult.exitCode),
      run.tokenUsage.totalTokens === undefined ? "unavailable" : String(run.tokenUsage.totalTokens),
      `${run.tokenUsageSource} / ${run.tokenUsageReliability}`,
      `${run.correctness.correctnessScore} (${run.correctness.passed ? "pass" : "fail"})`,
      [run.artifactPaths.promptPath, run.artifactPaths.agentRunResultPath, run.artifactPaths.parsedAnswerPath, run.artifactPaths.correctnessScorePath]
        .filter(Boolean)
        .join("\n")
    ])
  );
}

function renderCorrectness(runs: ExperimentRun[]): string {
  return table(
    ["Run ID", "File", "Symbol", "Fact", "Score", "Required facts", "Files", "Symbols", "Failure reasons"],
    runs.map((run) => [
      run.runId,
      String(run.correctness.fileMatchScore),
      String(run.correctness.symbolMatchScore),
      String(run.correctness.factMatchScore),
      String(run.correctness.correctnessScore),
      `${run.correctness.requiredFactsFound}/${run.correctness.requiredFactsTotal}`,
      `${run.correctness.expectedFilesFound}/${run.correctness.expectedFilesTotal}`,
      `${run.correctness.expectedSymbolsFound}/${run.correctness.expectedSymbolsTotal}`,
      run.correctness.failureReasons.join("; ")
    ])
  );
}

function renderTokenComparisons(comparisons: ExperimentComparison[]): string {
  return table(
    ["Comparison", "Raw tokens", "my-dev-kit tokens", "Token delta", "Savings percent", "Available", "Warnings"],
    comparisons.map((comparison) => [
      comparison.comparisonId,
      comparison.rawTotalTokens === undefined ? "missing" : String(comparison.rawTotalTokens),
      comparison.myDevKitTotalTokens === undefined ? "missing" : String(comparison.myDevKitTotalTokens),
      comparison.tokenDelta === undefined ? "unavailable" : String(comparison.tokenDelta),
      comparison.tokenSavingsPercent === undefined ? "unavailable" : `${comparison.tokenSavingsPercent}%`,
      String(comparison.tokenComparisonAvailable),
      comparison.warnings.join("; ")
    ])
  );
}

function renderTimingComparisons(comparisons: ExperimentComparison[]): string {
  return table(
    ["Comparison", "Raw duration", "my-dev-kit duration", "Delta", "Reduction percent", "Reliability"],
    comparisons.map((comparison) => [
      comparison.comparisonId,
      comparison.rawDurationMs === undefined ? "missing" : `${comparison.rawDurationMs} ms`,
      comparison.myDevKitDurationMs === undefined ? "missing" : `${comparison.myDevKitDurationMs} ms`,
      comparison.durationDeltaMs === undefined ? "unavailable" : `${comparison.durationDeltaMs} ms`,
      comparison.durationReductionPercent === undefined ? "unavailable" : `${comparison.durationReductionPercent}%`,
      comparison.reliabilityLabel
    ])
  );
}

function renderComparisons(comparisons: ExperimentComparison[]): string {
  return table(
    [
      "Comparison ID",
      "Case",
      "Project",
      "Agent",
      "Complexity",
      "Raw run",
      "my-dev-kit run",
      "Raw status",
      "my-dev-kit status",
      "Raw correctness",
      "my-dev-kit correctness",
      "Same pass",
      "Token savings",
      "Duration reduction",
      "Reliability",
      "Warnings"
    ],
    comparisons.map((comparison) => [
      comparison.comparisonId,
      comparison.caseId,
      comparison.benchmarkProject,
      comparison.agentId,
      comparison.complexityLevel,
      comparison.rawRunId ?? "",
      comparison.myDevKitRunId ?? "",
      comparison.rawStatus ?? "",
      comparison.myDevKitStatus ?? "",
      comparison.rawCorrectnessScore === undefined ? "" : String(comparison.rawCorrectnessScore),
      comparison.myDevKitCorrectnessScore === undefined ? "" : String(comparison.myDevKitCorrectnessScore),
      String(comparison.sameCorrectnessPass),
      comparison.tokenSavingsPercent === undefined ? "unavailable" : `${comparison.tokenSavingsPercent}%`,
      comparison.durationReductionPercent === undefined ? "unavailable" : `${comparison.durationReductionPercent}%`,
      comparison.reliabilityLabel,
      comparison.warnings.join("; ")
    ])
  );
}

function answerCard(label: string, answer: string): string {
  return `<div class="card"><div>${escapeHtml(label)}</div><div class="metric"><span class="badge answer-${escapeHtml(answer)}">${escapeHtml(answer)}</span></div></div>`;
}

function metricCard(label: string, value: string | number): string {
  return `<div class="card"><div>${escapeHtml(label)}</div><div class="metric">${escapeHtml(value)}</div></div>`;
}

function keyValueTable(values: Record<string, string | number | undefined>): string {
  return table(
    ["Metric", "Value"],
    Object.entries(values).map(([key, value]) => [key, value === undefined ? "" : String(value)])
  );
}

function table(headers: string[], rows: string[][], allowHtml = false): string {
  return `<table><thead><tr>${headers.map((header) => `<th>${escapeHtml(header)}</th>`).join("")}</tr></thead><tbody>${rows
    .map((row) => `<tr>${row.map((cell) => `<td>${allowHtml ? cell : escapeHtml(cell)}</td>`).join("")}</tr>`)
    .join("")}</tbody></table>`;
}

function list(items: string[]): string {
  return `<ul>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`;
}

function escapeHtml(value: string | number | boolean | undefined): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
