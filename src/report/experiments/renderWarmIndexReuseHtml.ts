import type { WarmIndexNumberMetricV1 } from "../../experiments/plugins/warmIndexReuse/metrics.js";
import type {
  WarmIndexReuseReportAgentV1,
  WarmIndexReuseReportProjectV1,
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
      ["Fake-agent correctness available (task sides)", `${section.summary.agentCorrectnessAvailableCount} of ${section.summary.agentSideCount}`],
      ["Fake-agent token totals available (task sides)", `${section.summary.agentTotalTokensAvailableCount} of ${section.summary.agentSideCount}`],
    ])}
    <h3>Cold Start And Warm Reuse</h3>
    ${list(section.costModel)}
    <h3>Limitations</h3>
    ${list(section.limitations)}
    ${section.projects.length === 0 ? "<p>No warm-index project evidence was recorded.</p>" : section.projects.map(renderProject).join("\n")}
  </section>`;
}

function renderProject(project: WarmIndexReuseReportProjectV1, index: number): string {
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
        ["Raw fake-agent correctness", task.raw.agentCorrectness],
        ["Warm fake-agent correctness", task.warm.agentCorrectness],
        ["Raw fake-agent total tokens", task.raw.agentTotalTokens],
        ["Warm fake-agent total tokens", task.warm.agentTotalTokens],
        ["Cumulative raw fake-agent total tokens", task.raw.cumulativeAgentTotalTokens],
        ["Cumulative warm fake-agent total tokens", task.warm.cumulativeAgentTotalTokens],
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
    <p class="muted">Estimated tokens are character-based context-size estimates, not provider token usage.</p>
    <p class="muted">Agent columns are deterministic fake-agent evidence; token totals are simulated harness telemetry, not provider billing telemetry.</p>
    ${table(
      [
        "Task",
        "Raw fake-agent status",
        "Warm fake-agent status",
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

function formatAgent(agent: WarmIndexReuseReportAgentV1 | null): string {
  if (agent === null) return "not run";
  const passed = agent.passed === null ? "" : agent.passed ? ", passed" : ", not passed";
  return `${agent.status}${passed}${agent.errors[0] ? ` (${agent.errors[0]})` : ""}`;
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
