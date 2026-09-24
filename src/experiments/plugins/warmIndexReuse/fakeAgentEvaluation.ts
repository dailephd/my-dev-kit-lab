// v0.5.2 Batch 3 -- thin compatibility re-export. The shared bounded evidence types,
// scoring/classification pipeline, and both the fake-agent and real-agent campaign evaluators now
// live in one owner: ./agentEvaluation.ts. This file exists only so existing direct imports (for
// example src/experiments/plugins/warmIndexReuse/metrics.ts and
// src/report/experiments/buildWarmIndexReuseReport.ts) and existing tests keep working unchanged.
export {
  evaluateWarmIndexFakeAgents,
  type WarmIndexAgentSideEvidenceV1,
  type WarmIndexAgentVariantId,
  type WarmIndexProjectAgentEvidenceV1,
  type WarmIndexTaskAgentEvidenceV1,
} from "./agentEvaluation.js";
