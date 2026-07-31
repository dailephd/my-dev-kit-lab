// v0.4.5 Batch 3: exact mirror of the local my-dev-kit-orchestrator v1.2.3 run-integrity
// contract (src/runIntegrityGate.ts RunIntegrityGateResult, src/judgeIntegrity.ts
// JudgeIntegrityResult / FinalReportEligibilityResult, src/artifactLifecycle.ts
// ArtifactStateRecord / ArtifactLifecycleState, src/correctionRouter.ts
// CorrectionRouteResult, src/judgeParser.ts JudgeVerdict). The orchestrator computes these
// as in-memory TypeScript results (and, for artifact-state.json, a real JSON file) rather
// than emitting one combined JSON artifact; this file bundles them under one lab-owned
// envelope for fixture/reader convenience while preserving every nested field name and
// shape byte-exact to its upstream owner. No field is renamed, flattened, or merged beyond
// this bundling.
import type { OrchestratorContextReadinessResultV1 } from "./orchestratorContextReadinessResultV1.js";

// --- src/judgeParser.ts ---------------------------------------------------------------

export const JUDGE_VERDICTS = [
  "PASS",
  "DESIGN_INCOMPLETE",
  "PSEUDOCODE_INCOMPLETE",
  "IMPLEMENTATION_MISMATCH",
  "TEST_COVERAGE_INCOMPLETE",
  "ARCHITECTURE_MISMATCH",
  "NEED_VERIFICATION",
  "NEED_CONTEXT",
  "SCOPE_VIOLATION",
  "BLOCKED"
] as const;
export type JudgeVerdict = (typeof JUDGE_VERDICTS)[number];

// --- src/correctionRouter.ts ----------------------------------------------------------

export const CORRECTABLE_STAGES = [
  "architecture-context",
  "behavior-model",
  "pseudocode-packet",
  "test-strategy",
  "test-implementation",
  "implementation",
  "verification",
  "target-architecture"
] as const;
export type CorrectableStage = (typeof CORRECTABLE_STAGES)[number];

export const ROUTE_STATUSES = ["pass", "correction_required", "blocked", "unknown_verdict", "missing_verdict"] as const;
export type RouteStatus = (typeof ROUTE_STATUSES)[number];

export type CorrectionRouteResultV1 = {
  verdict: JudgeVerdict | null;
  recommendedStage: string | null;
  routedStage: CorrectableStage | null;
  routeStatus: RouteStatus;
  warnings: string[];
  errors: string[];
  isBlocked: boolean;
  strictFail: boolean;
};

// --- src/runIntegrityGate.ts ----------------------------------------------------------

export const RUN_INTEGRITY_READINESS_CLASSIFICATIONS = ["not-required", "ready", "refresh-required"] as const;
export type RunIntegrityReadinessClassification = (typeof RUN_INTEGRITY_READINESS_CLASSIFICATIONS)[number];

export type RunIntegrityExpectedJudgeVerdict = "PASS" | "NEED_CONTEXT";

export const CONTEXT_SENSITIVE_STAGE_NAMES = ["implementation", "test-implementation"] as const;
export type ContextSensitiveStageName = (typeof CONTEXT_SENSITIVE_STAGE_NAMES)[number];

export type OrchestratorRunIntegrityGateV1 = {
  schemaVersion: "1.0.0";
  mode: string;
  contextRequired: boolean;
  applicableContextKinds: Array<"implementation" | "test">;
  implementationContext?: OrchestratorContextReadinessResultV1;
  testContext?: OrchestratorContextReadinessResultV1;
  contextReady: boolean;
  readinessClassification: RunIntegrityReadinessClassification;
  blockedStageNames: ContextSensitiveStageName[];
  blockingCodes: string[];
  primaryBlocker?: OrchestratorContextReadinessResultV1["blockerSummary"];
  recommendedCorrectionStage: string | null;
  expectedJudgeVerdict: RunIntegrityExpectedJudgeVerdict;
  warnings: string[];
};

// --- src/judgeIntegrity.ts --------------------------------------------------------------

export const JUDGE_VERDICT_PARSE_STATUSES = ["parsed", "missing-artifact", "missing-verdict", "unknown-verdict"] as const;
export type JudgeVerdictParseStatus = (typeof JUDGE_VERDICT_PARSE_STATUSES)[number];

export type OrchestratorJudgeIntegrityV1 = {
  schemaVersion: "1.0.0";
  judgeArtifactPresent: boolean;
  judgeVerdictParseStatus: JudgeVerdictParseStatus;
  authoredJudgeVerdict: JudgeVerdict | null;
  expectedJudgeVerdict: RunIntegrityExpectedJudgeVerdict;
  judgeVerdictMatchesExpected: boolean;
  judgeVerdictAccepted: boolean;
  correctionRequired: boolean;
  correctionBlocked: boolean;
  acceptedCorrectionStage: string | null;
  finalReportEligible: boolean;
  blockingCodes: string[];
  primaryReason?: string;
  acceptedCorrectionRoute: CorrectionRouteResultV1 | null;
};

export type OrchestratorFinalReportEligibilityV1 = {
  eligible: boolean;
  contextReady: boolean;
  priorArtifactsValid: boolean;
  judgeIntegrity: OrchestratorJudgeIntegrityV1;
  blockingCodes: string[];
  primaryReason?: string;
};

// --- src/artifactLifecycle.ts -----------------------------------------------------------

export const ARTIFACT_LIFECYCLE_STATES = ["missing", "incomplete", "blocked", "complete", "stale"] as const;
export type ArtifactLifecycleState = (typeof ARTIFACT_LIFECYCLE_STATES)[number];

export const MANUAL_ARTIFACT_LIFECYCLE_STATES = ["incomplete", "blocked", "complete"] as const;
export type ManualArtifactLifecycleState = (typeof MANUAL_ARTIFACT_LIFECYCLE_STATES)[number];

// Exact mirror of one artifact-state.json entry (src/artifactLifecycle.ts ArtifactStateRecord).
export type OrchestratorArtifactStateRecordV1 = {
  state: ManualArtifactLifecycleState;
  updatedAt: string;
  reason?: string;
  source?: string;
};

// One resolved lifecycle entry for a single stage artifact file. `manualRecord` is the exact
// artifact-state.json record when present (or null when the orchestrator holds no manual
// record for this file); `resolvedState` is the gate-aware result already computed by
// resolveArtifactStateWithRunIntegrity() -- the lab never recomputes it from fileExists and
// manualRecord itself, since staleness/upstream-artifact comparison logic belongs to the
// orchestrator.
export type OrchestratorArtifactLifecycleEntryV1 = {
  artifactFile: string;
  stageName: string;
  fileExists: boolean;
  manualRecord: OrchestratorArtifactStateRecordV1 | null;
  resolvedState: ArtifactLifecycleState;
  blockingReason?: string;
};

// --- lab-owned bundling envelope (fixture/reader convenience only) ---------------------

export type OrchestratorRunIntegrityEvidenceV1 = {
  schemaVersion: "1.0.0";
  runFolder: string;
  gate: OrchestratorRunIntegrityGateV1;
  judgeIntegrity?: OrchestratorJudgeIntegrityV1;
  finalReportEligibility?: OrchestratorFinalReportEligibilityV1;
  finalArtifactPresent?: boolean;
  finalArtifactVerdict?: JudgeVerdict | null;
  lifecycle: OrchestratorArtifactLifecycleEntryV1[];
};
