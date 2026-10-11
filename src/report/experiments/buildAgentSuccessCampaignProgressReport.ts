import { assertValidatedCampaignProgress, type ValidatedCampaignProgress } from "../../experiments/plugins/agentSuccessRate/campaignProgress.js";
import type { CampaignStoreBoundary } from "../../experiments/plugins/agentSuccessRate/campaignCheckpointStore.js";
/** All representations copy the same validated revision; no renderer evaluates tasks. */
export function buildAgentSuccessCampaignProgressReport(snapshot: ValidatedCampaignProgress, boundary: CampaignStoreBoundary) {
  assertValidatedCampaignProgress(snapshot, boundary);
  return structuredClone(snapshot.model);
}
