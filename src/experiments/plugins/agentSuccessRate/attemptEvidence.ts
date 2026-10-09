import type { AgentSuccessTreatmentEvidenceV1 } from "./executionTypes.js";

/**
 * Every complete attempt evidence record of one treatment, in execution order. Real-agent treatments list their attempts;
 * a deterministic-fixture treatment (or a Batch 4 style record) is its own single attempt.
 */
export function attemptEvidenceOf(treatment: AgentSuccessTreatmentEvidenceV1): AgentSuccessTreatmentEvidenceV1[] {
  return treatment.attempts && treatment.attempts.length > 0 ? treatment.attempts.map((attempt) => attempt.evidence) : [treatment];
}
