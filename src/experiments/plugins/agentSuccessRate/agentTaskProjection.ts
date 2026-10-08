import type { AgentSuccessTaskV1 } from "../../../evaluation/agentSuccess/index.js";
import type { TaskLocality } from "../../../evaluation/types.js";

/**
 * The only task data a coding agent may see. It is an explicit allowlist, not a redaction of the full task: a field
 * added to AgentSuccessTaskV1 later cannot reach a prompt unless it is deliberately added here and in
 * AgentFacingTaskSource.
 */
export type AgentFacingTaskV1 = Readonly<{
  caseId: string;
  benchmarkProject: string;
  title: string;
  instruction: string;
  query: string;
  taskLocality: TaskLocality;
}>;

/** The narrow input type: callers may pass a full task, but only these fields are ever read. */
export type AgentFacingTaskSource = Pick<AgentSuccessTaskV1, "id" | "benchmarkProject" | "title" | "instruction" | "query" | "taskLocality">;

export const AGENT_FACING_TASK_FIELDS = ["caseId", "benchmarkProject", "title", "instruction", "query", "taskLocality"] as const;

/** Builds a fresh object from named fields. It never spreads, serializes or iterates the source task. */
export function projectAgentFacingTask(task: AgentFacingTaskSource): AgentFacingTaskV1 {
  return Object.freeze({
    caseId: task.id,
    benchmarkProject: task.benchmarkProject,
    title: task.title,
    instruction: task.instruction,
    query: task.query,
    taskLocality: task.taskLocality
  });
}
