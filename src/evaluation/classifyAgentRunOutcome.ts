import type { AgentRunResult } from "../agents/types.js";
import type { ExperimentRunStatus, ParsedAgentAnswer } from "./controlledExperimentTypes.js";

export type AgentRunOutcomeClassification = {
  status: ExperimentRunStatus;
  statusReason: string;
  warnings: string[];
  errors: string[];
};

const LIMIT_PATTERNS = [
  /usage\s+limit/i,
  /rate\s+limit/i,
  /quota/i,
  /session\s+limit/i,
  /limit\s+reached/i,
  /too\s+many\s+requests/i,
  /exhausted/i,
  /insufficient\s+quota/i,
  /daily\s+limit/i,
  /monthly\s+limit/i
];

export function classifyAgentRunOutcome(args: {
  agentRunResult: AgentRunResult;
  parsedAnswer?: ParsedAgentAnswer;
}): AgentRunOutcomeClassification {
  const result = args.agentRunResult;
  const warnings = [...result.warnings, ...(args.parsedAnswer?.warnings ?? [])];
  const errors = [...result.errors];
  const combinedText = [result.finalAnswerText, ...result.warnings, ...result.errors].join("\n");

  if (result.status === "skipped" && /not available|unavailable|not found/i.test(combinedText)) {
    return { status: "agent-unavailable", statusReason: "Agent executable is unavailable.", warnings, errors };
  }
  if (LIMIT_PATTERNS.some((pattern) => pattern.test(combinedText))) {
    return { status: "agent-limit-reached", statusReason: "Agent output indicates an external usage or session limit.", warnings, errors };
  }
  if (/timed out after|timeout|timed out/i.test(combinedText)) {
    return { status: "timeout", statusReason: "Agent command timed out.", warnings, errors };
  }
  if (result.status === "failed") {
    return { status: "failed", statusReason: result.errors[0] ?? "Agent run failed.", warnings, errors };
  }
  if (result.status === "skipped") {
    return { status: "skipped", statusReason: result.warnings[0] ?? "Agent run was skipped.", warnings, errors };
  }
  if (result.status === "completed" && args.parsedAnswer?.parseStatus === "failed") {
    return { status: "invalid-output", statusReason: "Agent completed but answer could not be parsed for scoring.", warnings, errors };
  }
  if (result.status === "completed" && args.parsedAnswer?.parseStatus === "partial") {
    return { status: "invalid-output", statusReason: "Agent completed but answer was only partially parseable for scoring.", warnings, errors };
  }
  return { status: "completed", statusReason: "Agent completed and answer was scoreable.", warnings, errors };
}
