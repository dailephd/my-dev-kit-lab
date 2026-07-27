// v0.4.4 Batch 3: additive producer-readiness bridge evaluator. Composes the Batch 2 pure
// calculators over already-loaded raw (ContextCapsule/RetrievalAuditRecord), supplemental
// (Batch 1 packet/report), and readiness (Batch 1 adapter) evidence for the
// combined-bounded-stage-context strategy. Never rereads artifacts, never reruns owner
// selection/allocation/producer-parity/readiness -- it only reads already-preserved fields
// and calls each Batch 2 calculator exactly once per applicable side (implementation /
// test-implementation).
import type {
  ContextCapsule,
  RetrievalAuditRecord,
  SupplementalContextDocumentV1
} from "../upstreamArtifacts/index.js";
import type {
  ProducerReadinessExpectationsV1,
  StageContextExpectationFixtureV1
} from "../stageContextExpectations/index.js";
import { collectSelectedOwnerEvidence, calculateOwnerMetrics } from "./calculateOwnerMetrics.js";
import { calculateAllocationFactsForGroups } from "./calculateAllocationMetrics.js";
import { classifyTruncationRecords } from "./calculateTruncationClassification.js";
import { calculateSupplementalRawAgreement } from "./calculateSupplementalRawAgreement.js";
import { calculateReadinessAgreementMetrics } from "./calculateReadinessAgreement.js";
import { calculateCriticalityMetrics } from "./calculateCriticalityMetrics.js";
import type {
  AllocationMetricsV1,
  OwnerMetricsV1,
  ReadinessAgreementMetricsV1,
  SupplementalRawAgreementV1,
  TruncationClassificationV1,
  CriticalityMetricsV1
} from "./producerReadinessMetricTypes.js";

export interface ProducerReadinessBridgeSideInputV1 {
  role: "implementation" | "test-implementation";
  contextCapsule?: ContextCapsule;
  retrievalAuditRecord?: RetrievalAuditRecord;
  packet?: SupplementalContextDocumentV1;
  packetSourcePath?: string;
  report?: SupplementalContextDocumentV1;
}

export interface ProducerReadinessBridgeInputV1 {
  implementation?: ProducerReadinessBridgeSideInputV1;
  testImplementation?: ProducerReadinessBridgeSideInputV1;
  readiness?: import("../upstreamArtifacts/index.js").OrchestratorContextReadinessResultV1;
  expectations: StageContextExpectationFixtureV1;
}

export interface ProducerReadinessBridgeSideEvaluationV1 {
  role: "implementation" | "test-implementation";
  ownerEvaluation: OwnerMetricsV1;
  allocationEvaluation: AllocationMetricsV1;
  truncationEvaluation: TruncationClassificationV1[];
  packetAgreement: SupplementalRawAgreementV1 | null;
  reportAgreement: SupplementalRawAgreementV1 | null;
}

export interface ProducerReadinessBridgeEvaluationResultV1 {
  status: "evaluated" | "not-applicable";
  reason: string | null;
  implementation: ProducerReadinessBridgeSideEvaluationV1 | null;
  testImplementation: ProducerReadinessBridgeSideEvaluationV1 | null;
  readinessAgreement: ReadinessAgreementMetricsV1 | null;
  criticalityEvaluation: CriticalityMetricsV1 | null;
  warnings: string[];
  evidenceReferences: string[];
}

function ownerExpectationsFor(
  expectations: ProducerReadinessExpectationsV1 | undefined,
  sourceArtifact: "context-capsule" | "retrieval-audit-record"
) {
  return expectations?.ownerExpectations?.filter((e) => e.sourceArtifact === sourceArtifact);
}

function evaluateSide(input: ProducerReadinessBridgeSideInputV1, expectations: StageContextExpectationFixtureV1 | undefined) {
  const producerExpectations = expectations?.producerReadinessExpectations;
  // Owner-selection and allocation-group evidence only exist on ContextCapsule (Batch 1
  // contract-lock evidence: RetrievalAuditRecord has no selectedOwners/evidenceGroups
  // fields). Truncation and responsibility-mapping evidence exist on both.
  const capsule = input.contextCapsule;
  const truncationArtifact = input.contextCapsule ?? input.retrievalAuditRecord;
  const rawForAgreement = input.contextCapsule ?? input.retrievalAuditRecord;

  const selectedOwnerEvidence = capsule ? collectSelectedOwnerEvidence(capsule.selectedOwners, "context-capsule", input.role) : undefined;
  const ownerEvaluation = calculateOwnerMetrics(selectedOwnerEvidence, ownerExpectationsFor(producerExpectations, "context-capsule"));

  const allocationFacts = capsule
    ? calculateAllocationFactsForGroups(capsule.evidenceGroups, "context-capsule", input.role)
    : { requiredGroupCapacity: [], usedReservation: [], borrowedCapacity: [], unusedCapacity: [] };
  const allocationEvaluation: AllocationMetricsV1 = {
    ...allocationFacts,
    requiredEvidenceOmitted: {
      availability: "not-applicable",
      count: null,
      evidenceKeys: [],
      reason: "Batch 3 bridge evaluation derives omission from truncation records, not expectation matches; see truncationEvaluation."
    },
    requiredEvidenceOmittedEntries: []
  };

  const truncationSourceArtifact: "context-capsule" | "retrieval-audit-record" = input.contextCapsule ? "context-capsule" : "retrieval-audit-record";
  const truncationEvaluation = truncationArtifact
    ? classifyTruncationRecords(truncationArtifact.truncation.records, truncationSourceArtifact, input.role)
    : [];

  const packetAgreement =
    input.packet !== undefined || rawForAgreement !== undefined ? calculateSupplementalRawAgreement(input.packet, rawForAgreement) : null;
  const reportAgreement =
    input.report !== undefined || rawForAgreement !== undefined ? calculateSupplementalRawAgreement(input.report, rawForAgreement) : null;

  return { ownerEvaluation, allocationEvaluation, truncationEvaluation, packetAgreement, reportAgreement };
}

interface CombinedPayloadLike {
  contextArtifacts: readonly {
    role: "architecture" | "implementation" | "test-implementation";
    contextCapsule: ContextCapsule;
    contextCapsuleSourcePath: string;
    retrievalAuditRecord?: RetrievalAuditRecord;
  }[];
  implementationContextPacket?: SupplementalContextDocumentV1;
  implementationContextPacketSourcePath?: string;
  implementationContextRetrievalReport?: SupplementalContextDocumentV1;
  testContextPacket?: SupplementalContextDocumentV1;
  testContextPacketSourcePath?: string;
  testContextRetrievalReport?: SupplementalContextDocumentV1;
  readiness?: import("../upstreamArtifacts/index.js").OrchestratorContextReadinessResultV1;
}

// Builds bridge-evaluator input from an already-loaded combined-bounded-stage-context
// execution payload (Batch 3 section 12.1: "accept already-read raw, supplemental,
// readiness, and expectation inputs"). Never reads a file itself.
export function buildProducerReadinessBridgeInputFromCombinedPayload(
  payload: CombinedPayloadLike,
  expectations: StageContextExpectationFixtureV1
): ProducerReadinessBridgeInputV1 {
  const implementationPair = payload.contextArtifacts.find((p) => p.role === "implementation");
  const testPair = payload.contextArtifacts.find((p) => p.role === "test-implementation");

  const hasImplementationSide =
    implementationPair !== undefined || payload.implementationContextPacket !== undefined || payload.implementationContextRetrievalReport !== undefined;
  const hasTestSide = testPair !== undefined || payload.testContextPacket !== undefined || payload.testContextRetrievalReport !== undefined;

  return {
    implementation: hasImplementationSide
      ? {
          role: "implementation",
          contextCapsule: implementationPair?.contextCapsule,
          retrievalAuditRecord: implementationPair?.retrievalAuditRecord,
          packet: payload.implementationContextPacket,
          packetSourcePath: payload.implementationContextPacketSourcePath,
          report: payload.implementationContextRetrievalReport
        }
      : undefined,
    testImplementation: hasTestSide
      ? {
          role: "test-implementation",
          contextCapsule: testPair?.contextCapsule,
          retrievalAuditRecord: testPair?.retrievalAuditRecord,
          packet: payload.testContextPacket,
          packetSourcePath: payload.testContextPacketSourcePath,
          report: payload.testContextRetrievalReport
        }
      : undefined,
    readiness: payload.readiness,
    expectations
  };
}

export function evaluateProducerReadinessBridge(input: ProducerReadinessBridgeInputV1): ProducerReadinessBridgeEvaluationResultV1 {
  const hasAnyInput =
    input.implementation !== undefined || input.testImplementation !== undefined || input.readiness !== undefined;

  if (!hasAnyInput) {
    return {
      status: "not-applicable",
      reason: "No producer-readiness bridge inputs (supplemental artifacts or readiness result) were supplied.",
      implementation: null,
      testImplementation: null,
      readinessAgreement: null,
      criticalityEvaluation: null,
      warnings: [],
      evidenceReferences: []
    };
  }

  const evidenceReferences: string[] = [];
  const warnings: string[] = [];

  let implementation: ProducerReadinessBridgeSideEvaluationV1 | null = null;
  if (input.implementation !== undefined) {
    const evaluated = evaluateSide(input.implementation, input.expectations);
    implementation = { role: "implementation", ...evaluated };
    if (input.implementation.packetSourcePath) evidenceReferences.push(input.implementation.packetSourcePath);
  }

  let testImplementation: ProducerReadinessBridgeSideEvaluationV1 | null = null;
  if (input.testImplementation !== undefined) {
    const evaluated = evaluateSide(input.testImplementation, input.expectations);
    testImplementation = { role: "test-implementation", ...evaluated };
    if (input.testImplementation.packetSourcePath) evidenceReferences.push(input.testImplementation.packetSourcePath);
  }

  let readinessAgreement: ReadinessAgreementMetricsV1 | null = null;
  if (input.readiness !== undefined) {
    const readinessExpectations = input.expectations.producerReadinessExpectations?.readinessExpectations;
    const matchingExpectation = readinessExpectations?.find((e) => e.kind === input.readiness!.kind);
    const relevantPacket = input.readiness.kind === "implementation" ? input.implementation?.packet : input.testImplementation?.packet;
    const relevantPacketPath = input.readiness.kind === "implementation" ? input.implementation?.packetSourcePath : input.testImplementation?.packetSourcePath;
    readinessAgreement = calculateReadinessAgreementMetrics(input.readiness, matchingExpectation, relevantPacket, relevantPacketPath);
  }

  const criticalityMappings =
    input.testImplementation?.retrievalAuditRecord?.responsibilityMappings.mappings ??
    input.testImplementation?.contextCapsule?.responsibilityMappings.mappings ??
    input.implementation?.retrievalAuditRecord?.responsibilityMappings.mappings ??
    input.implementation?.contextCapsule?.responsibilityMappings.mappings;
  const criticalityEvaluation = calculateCriticalityMetrics(
    criticalityMappings,
    input.expectations.producerReadinessExpectations?.criticalityExpectations
  );

  return {
    status: "evaluated",
    reason: null,
    implementation,
    testImplementation,
    readinessAgreement,
    criticalityEvaluation,
    warnings,
    evidenceReferences
  };
}
