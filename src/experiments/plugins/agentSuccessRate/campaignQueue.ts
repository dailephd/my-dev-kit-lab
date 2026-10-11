import type { AgentSuccessTaskV1 } from "../../../evaluation/agentSuccess/index.js";
import { validateAgentSuccessTask } from "../../../evaluation/agentSuccess/index.js";
import { campaignAssert, canonicalCampaignJson } from "./campaignIdentity.js";
import { AGENT_SUCCESS_RATE_TREATMENT_IDS, type AgentSuccessRateTreatmentId } from "./metadata.js";

export type CampaignExecutionLimit = "one-case" | "all-selected-cases";
export type CampaignQueueUnit = { task: AgentSuccessTaskV1; treatmentId: AgentSuccessRateTreatmentId; checkpointIndex: number };

/** Selection is already established by selectAgentSuccessTasks. Never sort, interleave or drop a treatment. */
export function buildCampaignQueue(tasks: readonly AgentSuccessTaskV1[], treatments: readonly AgentSuccessRateTreatmentId[], limit: CampaignExecutionLimit): CampaignQueueUnit[] {
  campaignAssert(tasks.length > 0 && tasks.length <= 1000 && new Set(tasks.map((t) => t.id)).size === tasks.length, "INVALID_SELECTION");
  tasks.forEach((task) => campaignAssert(validateAgentSuccessTask(task).ok, "INVALID_SELECTION"));
  campaignAssert(canonicalCampaignJson(treatments) === canonicalCampaignJson(AGENT_SUCCESS_RATE_TREATMENT_IDS), "FIXED_TREATMENTS_REQUIRED");
  campaignAssert(limit === "one-case" || limit === "all-selected-cases", "INVALID_EXECUTION_LIMIT");
  return tasks.slice(0, limit === "one-case" ? 1 : tasks.length).flatMap((task, caseIndex) =>
    AGENT_SUCCESS_RATE_TREATMENT_IDS.map((treatmentId, treatmentIndex) => ({ task, treatmentId, checkpointIndex: caseIndex * 2 + treatmentIndex })));
}
