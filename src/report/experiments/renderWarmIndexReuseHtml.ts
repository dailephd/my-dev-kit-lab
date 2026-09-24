import { agentLabel, type WarmIndexNumberMetricV1 } from "../../experiments/plugins/warmIndexReuse/metrics.js";
import type {
  WarmIndexReuseReportAgentV1,
  WarmIndexReuseReportCampaignV1,
  WarmIndexReuseReportFreshnessSummaryV1,
  WarmIndexReuseReportProjectV1,
  WarmIndexReuseReportTaskV1,
  WarmIndexReuseReportV1,
} from "./warmIndexReuseReportModel.js";

const UNIT_LABELS: Record<WarmIndexNumberMetricV1["unit"], string> = {
  ms: "ms",
  characters: "chars",
  "estimated-tokens": "est. tokens",
  tokens: "tokens",
  score: "score",
};

export function renderWarmIndexReuseHtml(section: WarmIndexReuseReportV1 | null): string {
  if (section === null) {
    return `<section>
    <h2>Warm Index Reuse Evidence</h2>
    <p>Not applicable to this plugin.</p>
  </section>`;
  }
  return `<section>
    <h2>Warm Index Reuse Evidence</h2>
    ${table(["Field", "Value"], [
      ["Projects", String(section.summary.projectCount)],
      ["Tasks", String(section.summary.taskCount)],
      ["Projects with a prepared index session", String(section.summary.preparedSessionProjectCount)],
      ["Incomplete or failed projects", String(section.summary.incompleteProjectCount)],
      ["Agent ID", section.agent.id],
      ["Agent mode", section.agent.mode],
      ["Agent correctness available", `${section.summary.agentCorrectnessAvailableCount} of ${section.summary.agentSideCount}`],
      ["Agent token totals available", `${section.summary.agentTotalTokensAvailableCount} of ${section.summary.agentSideCount}`],
    ])}
    ${renderFreshnessSummary(section.indexFreshnessSummary ?? legacyFreshnessSummary(section.summary.taskCount))}
    ${section.agentCampaign ? renderCampaignSection(section.agentCampaign) : ""}
    <h3>Cold Start And Warm Reuse</h3>
    ${list(section.costModel)}
    <h3>Limitations</h3>
    ${list(section.limitations)}
    ${section.projects.length === 0 ? "<p>No warm-index project evidence was recorded.</p>" : section.projects.map((project, index) => renderProject(project, index, section.agent.id)).join("\n")}
  </section>`;
}

// Reports serialized before v0.6.0 Batch 3 lack the summary; they are rendered as having no assessment.
function legacyFreshnessSummary(taskCount: number): WarmIndexReuseReportFreshnessSummaryV1 {
  return {
    assessedTaskCount: 0,
    unassessedTaskCount: taskCount,
    freshTaskCount: 0,
    staleTaskCount: 0,
    partiallyStaleTaskCount: 0,
    unknownTaskCount: 0,
  };
}

function renderFreshnessSummary(summary: WarmIndexReuseReportFreshnessSummaryV1): string {
  return `<h3>Index Freshness</h3>
    ${table(["Field", "Value"], [
      ["Assessed tasks", String(summary.assessedTaskCount)],
      ["Unassessed tasks", String(summary.unassessedTaskCount)],
      ["Fresh tasks", String(summary.freshTaskCount)],
      ["Stale tasks", String(summary.staleTaskCount)],
      ["Partially-stale tasks", String(summary.partiallyStaleTaskCount)],
      ["Unknown tasks", String(summary.unknownTaskCount)],
    ])}`;
}

/** Persisted freshness evidence per task; hashes are deliberately absent from this presentation. */
function renderProjectFreshness(tasks: readonly WarmIndexReuseReportTaskV1[]): string {
  const overview = table(
    ["Task", "Freshness", "Baseline", "Indexed", "Comparable", "Unchanged", "Modified", "Missing", "Unresolved"],
    tasks.map((task) => {
      const freshness = task.indexFreshness;
      const label = `${task.taskOrdinal}. ${task.caseId}`;
      return freshness
        ? [
            label,
            freshness.status,
            freshness.baselineSnapshotStatus,
            String(freshness.indexedFileCount),
            String(freshness.comparableFileCount),
            String(freshness.unchangedFileCount),
            String(freshness.changedFileCount),
            String(freshness.missingFileCount),
            String(freshness.unresolvedFileCount),
          ]
        : [label, "not assessed", "unavailable", "", "", "", "", "", ""];
    })
  );
  const detailRows = tasks.flatMap((task) => {
    const freshness = task.indexFreshness;
    if (!freshness) return [];
    const label = `${task.taskOrdinal}. ${task.caseId}`;
    return [
      ...freshness.changes.items.map((change) => [label, change.changeType, change.path, ""]),
      ...freshness.unresolved.items.map((entry) => [label, "unresolved", entry.path ?? "run-level", `${entry.reasonCode}: ${entry.message}`]),
    ];
  });
  const omitted = tasks.flatMap((task) => {
    const freshness = task.indexFreshness;
    if (!freshness) return [];
    return [
      ...(freshness.changes.omittedCount > 0 ? [`Task ${task.taskOrdinal}: ${freshness.changes.omittedCount} of ${freshness.changes.totalCount} changes omitted.`] : []),
      ...(freshness.unresolved.omittedCount > 0
        ? [`Task ${task.taskOrdinal}: ${freshness.unresolved.omittedCount} of ${freshness.unresolved.totalCount} unresolved entries omitted.`]
        : []),
    ];
  });
  return `<h4>Index Freshness</h4>
    ${overview}
    ${detailRows.length === 0 ? "" : table(["Task", "Evidence type", "Path", "Detail"], detailRows)}
    ${omitted.length === 0 ? "" : list(omitted)}`;
}

function renderCampaignSection(campaign: WarmIndexReuseReportCampaignV1): string {
  return `<h3>Real-Agent Campaign</h3>
    ${table(["Field", "Value"], [
      ["Preset", campaign.presetId],
      ["Agent", campaign.agentId],
      ["Timeout (ms)", String(campaign.timeoutMs)],
      ["Scheduled agent sides", String(campaign.scheduledSideCount)],
      ["Executed agent sides", String(campaign.executedSideCount)],
      ["Not run for missing context", String(campaign.notRunForMissingContextCount)],
      ["Agent evidence status", campaign.agentEvidenceStatus],
      ["Token evidence status", campaign.tokenEvidenceStatus],
      ["Completed agent sides", String(campaign.outcomeCounts.completed)],
      ["Failed agent sides", String(campaign.outcomeCounts.failed)],
      ["Timeout agent sides", String(campaign.outcomeCounts.timeout)],
      ["Invalid-output agent sides", String(campaign.outcomeCounts.invalidOutput)],
      ["Agent-unavailable sides", String(campaign.outcomeCounts.agentUnavailable)],
      ["Agent-limit-reached sides", String(campaign.outcomeCounts.agentLimitReached)],
      ["Skipped agent sides", String(campaign.outcomeCounts.skipped)],
    ])}`;
}

function renderProject(project: WarmIndexReuseReportProjectV1, index: number, agentId: string): string {
  const unavailableRows = project.tasks.flatMap((task) =>
    (
      [
        ["Raw context characters", task.raw.contextCharacters],
        ["Warm context characters", task.warm.contextCharacters],
        ["Raw estimated context tokens", task.raw.contextEstimatedTokens],
        ["Warm estimated context tokens", task.warm.contextEstimatedTokens],
        ["Raw operation duration", task.raw.operationDurationMs],
        ["Warm retrieval duration", task.warm.retrievalDurationMs],
        ["Amortized index build duration", task.warm.amortizedIndexBuildDurationMs],
        ["Cumulative raw duration", task.raw.cumulativeDurationMs],
        ["Cumulative warm component duration", task.warm.cumulativeComponentDurationMs],
        ["Cumulative raw estimated context tokens", task.raw.cumulativeEstimatedContextTokens],
        ["Cumulative warm estimated context tokens", task.warm.cumulativeEstimatedContextTokens],
        ["Raw agent correctness", task.raw.agentCorrectness],
        ["Warm agent correctness", task.warm.agentCorrectness],
        ["Raw agent total tokens", task.raw.agentTotalTokens],
        ["Warm agent total tokens", task.warm.agentTotalTokens],
        ["Cumulative raw agent total tokens", task.raw.cumulativeAgentTotalTokens],
        ["Cumulative warm agent total tokens", task.warm.cumulativeAgentTotalTokens],
      ] as const
    )
      .filter(([, metric]) => metric.availability !== "available")
      .map(([label, metric]) => [String(task.taskOrdinal), task.caseId, label, metric.availability, metric.reason ?? ""])
  );
  return `<h3>Project ${index + 1}: ${escapeHtml(project.benchmarkProject)}</h3>
    ${table(["Field", "Value"], [
      ["Session key", project.sessionKey],
      ["Project status", project.status],
      ["Session prepared", String(project.sessionPrepared)],
      ["Index build duration", formatMetric(project.indexBuildDurationMs)],
      ["Index build duration availability", withReason(project.indexBuildDurationMs)],
      ["Tasks", String(project.taskCount)],
    ])}
    ${table(
      [
        "Task",
        "Raw status",
        "Warm status",
        "Raw chars",
        "Warm chars",
        "Raw est. tokens",
        "Warm est. tokens",
        "Raw duration",
        "Warm retrieval duration",
        "Amortized index cost",
        "Cumulative raw duration",
        "Cumulative warm duration",
        "Cumulative raw est. tokens",
        "Cumulative warm est. tokens",
      ],
      project.tasks.map((task) => [
        `${task.taskOrdinal}. ${task.caseId}`,
        task.rawStatus,
        task.warmStatus,
        formatMetric(task.raw.contextCharacters),
        formatMetric(task.warm.contextCharacters),
        formatMetric(task.raw.contextEstimatedTokens),
        formatMetric(task.warm.contextEstimatedTokens),
        formatMetric(task.raw.operationDurationMs),
        formatMetric(task.warm.retrievalDurationMs),
        formatMetric(task.warm.amortizedIndexBuildDurationMs),
        formatMetric(task.raw.cumulativeDurationMs),
        formatMetric(task.warm.cumulativeComponentDurationMs),
        formatMetric(task.raw.cumulativeEstimatedContextTokens),
        formatMetric(task.warm.cumulativeEstimatedContextTokens),
      ])
    )}
    ${renderProjectFreshness(project.tasks)}
    <p class="muted">Estimated tokens are character-based context-size estimates, not provider token usage.</p>
    <p class="muted">${agentColumnsNote(agentId)}</p>
    ${table(
      [
        "Task",
        "Raw agent status",
        "Warm agent status",
        "Raw correctness",
        "Warm correctness",
        "Raw agent tokens",
        "Warm agent tokens",
        "Cumulative raw agent tokens",
        "Cumulative warm agent tokens",
        "Token source / reliability",
      ],
      project.tasks.map((task) => [
        `${task.taskOrdinal}. ${task.caseId}`,
        formatAgent(task.rawAgent),
        formatAgent(task.warmAgent),
        formatMetric(task.raw.agentCorrectness),
        formatMetric(task.warm.agentCorrectness),
        formatMetric(task.raw.agentTotalTokens),
        formatMetric(task.warm.agentTotalTokens),
        formatMetric(task.raw.cumulativeAgentTotalTokens),
        formatMetric(task.warm.cumulativeAgentTotalTokens),
        [task.rawAgent, task.warmAgent]
          .map((agent) => (agent ? `${agent.tokenUsageSource} / ${agent.tokenUsageReliability}` : "not run"))
          .join("; "),
      ])
    )}
    ${unavailableRows.length === 0 ? "" : table(["Task", "Case", "Metric", "Availability", "Reason"], unavailableRows)}`;
}

function agentColumnsNote(agentId: string): string {
  if (agentId === "fake-agent") {
    return "Agent columns are deterministic fake-agent evidence; token totals are simulated harness telemetry, not provider billing telemetry.";
  }
  const label = agentLabel(agentId as "codex" | "claude");
  return `Agent columns are ${label} campaign evidence; token totals are provider-reported adapter telemetry when available and are never replaced by a context-size estimate.`;
}

function formatAgent(agent: WarmIndexReuseReportAgentV1 | null): string {
  if (agent === null) return "not run";
  const passed = agent.passed === null ? "" : agent.passed ? ", passed" : ", not passed";
  return `${agentLabel(agent.agentId)}: ${agent.status}${passed}${agent.errors[0] ? ` (${agent.errors[0]})` : ""}`;
}

function formatMetric(metric: WarmIndexNumberMetricV1): string {
  return metric.availability === "available" ? `${metric.value} ${UNIT_LABELS[metric.unit]}` : metric.availability;
}

function withReason(metric: WarmIndexNumberMetricV1): string {
  return metric.availability === "available" ? formatMetric(metric) : `${metric.availability}: ${metric.reason ?? ""}`;
}

function list(items: string[]): string {
  return `<ul>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`;
}

function table(headers: string[], rows: string[][]): string {
  return `<table><thead><tr>${headers.map((header) => `<th>${escapeHtml(header)}</th>`).join("")}</tr></thead><tbody>${rows
    .map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join("")}</tr>`)
    .join("")}</tbody></table>`;
}

function escapeHtml(value: string | number | boolean | null | undefined): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
