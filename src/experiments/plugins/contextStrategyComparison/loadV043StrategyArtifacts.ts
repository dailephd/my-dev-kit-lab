import {
  readImplementationContextPacketV1,
  readImplementationContextRetrievalReportV1,
  readMyDevKitContextCapsuleV1,
  readMyDevKitRetrievalAuditRecordV1,
  readOrchestratorWorkflowInstructionPacketV1,
  readTestContextPacketV1,
  readTestContextRetrievalReportV1,
  validateOrchestratorContextReadinessResultV1
} from "../../../evaluation/upstreamArtifacts/index.js";
import type { ContextRole } from "../../../evaluation/upstreamArtifacts/index.js";
import { checkMyDevKitContextArtifactConsistency } from "../../../evaluation/stageContextSelectors/index.js";
import { readStageContextExpectationFixtureV1 } from "../../../evaluation/stageContextExpectations/index.js";
import { readV043FullWorkflowLibraryFixture } from "./readV043FullWorkflowLibraryFixture.js";
import type {
  CombinedBoundedStageContextExecutionPayloadV1,
  LoadedContextArtifactPairV1,
  V043StageContextStrategyExecutionFailed,
  V043StageContextStrategyExecutionIssue,
  V043StageContextStrategyExecutionResult
} from "./v043StrategyExecutionTypes.js";
import type { V043StageContextStrategyInputV1 } from "./v043StrategyInputContracts.js";

function buildFailureResult(
  input: V043StageContextStrategyInputV1,
  issues: V043StageContextStrategyExecutionIssue[]
): V043StageContextStrategyExecutionFailed {
  return { status: "failed", strategyId: input.strategyId, input, issues };
}

async function loadContextArtifactPair(
  role: ContextRole,
  capsulePath: string,
  auditPath: string | undefined,
  pairLabel: string,
  issues: V043StageContextStrategyExecutionIssue[]
): Promise<LoadedContextArtifactPairV1 | null> {
  const capsuleResult = await readMyDevKitContextCapsuleV1(capsulePath);
  if (!capsuleResult.ok) {
    issues.push({
      code: "CONTEXT_CAPSULE_READ_FAILED",
      fieldPath: `${pairLabel}.contextCapsule`,
      message: `Failed to read ContextCapsule for "${pairLabel}": ${capsuleResult.message}`,
      sourcePath: capsuleResult.sourcePath,
      details: capsuleResult
    });
  }

  let auditReadOk = false;
  let auditSourcePath: string | undefined;
  let auditArtifact: LoadedContextArtifactPairV1["retrievalAuditRecord"];

  if (auditPath !== undefined) {
    const auditResult = await readMyDevKitRetrievalAuditRecordV1(auditPath);
    if (!auditResult.ok) {
      issues.push({
        code: "RETRIEVAL_AUDIT_READ_FAILED",
        fieldPath: `${pairLabel}.retrievalAuditRecord`,
        message: `Failed to read RetrievalAuditRecord for "${pairLabel}": ${auditResult.message}`,
        sourcePath: auditResult.sourcePath,
        details: auditResult
      });
    } else {
      auditReadOk = true;
      auditSourcePath = auditResult.sourcePath;
      auditArtifact = auditResult.artifact;
    }
  }

  if (!capsuleResult.ok) return null;

  const pair: LoadedContextArtifactPairV1 = {
    role,
    contextCapsuleSourcePath: capsuleResult.sourcePath,
    contextCapsule: capsuleResult.artifact
  };
  if (auditReadOk) {
    pair.retrievalAuditRecordSourcePath = auditSourcePath;
    pair.retrievalAuditRecord = auditArtifact;
  }
  return pair;
}

function validateRole(
  pair: LoadedContextArtifactPairV1,
  expectedRole: ContextRole,
  pairLabel: string,
  issues: V043StageContextStrategyExecutionIssue[]
): void {
  if (pair.contextCapsule.request.role !== expectedRole) {
    const fieldPath = `${pairLabel}.contextCapsule.request.role`;
    issues.push({
      code: "CONTEXT_ROLE_MISMATCH",
      fieldPath,
      message: `Expected context role "${expectedRole}" but found "${pair.contextCapsule.request.role}" at "${fieldPath}".`
    });
  }
  if (pair.contextCapsule.roleContext.role !== expectedRole) {
    const fieldPath = `${pairLabel}.contextCapsule.roleContext.role`;
    issues.push({
      code: "CONTEXT_ROLE_MISMATCH",
      fieldPath,
      message: `Expected context role "${expectedRole}" but found "${pair.contextCapsule.roleContext.role}" at "${fieldPath}".`
    });
  }
  if (pair.retrievalAuditRecord) {
    if (pair.retrievalAuditRecord.request.role !== expectedRole) {
      const fieldPath = `${pairLabel}.retrievalAuditRecord.request.role`;
      issues.push({
        code: "CONTEXT_ROLE_MISMATCH",
        fieldPath,
        message: `Expected context role "${expectedRole}" but found "${pair.retrievalAuditRecord.request.role}" at "${fieldPath}".`
      });
    }
    if (pair.retrievalAuditRecord.roleContext.role !== expectedRole) {
      const fieldPath = `${pairLabel}.retrievalAuditRecord.roleContext.role`;
      issues.push({
        code: "CONTEXT_ROLE_MISMATCH",
        fieldPath,
        message: `Expected context role "${expectedRole}" but found "${pair.retrievalAuditRecord.roleContext.role}" at "${fieldPath}".`
      });
    }
  }
}

function checkPairConsistency(
  pair: LoadedContextArtifactPairV1,
  pairLabel: string,
  issues: V043StageContextStrategyExecutionIssue[]
): void {
  if (!pair.retrievalAuditRecord) return;
  const consistency = checkMyDevKitContextArtifactConsistency(pair.contextCapsule, pair.retrievalAuditRecord);
  pair.consistency = consistency;
  if (!consistency.consistent) {
    for (const consistencyIssue of consistency.issues) {
      const prefixedFieldPath = `${pairLabel}.${consistencyIssue.fieldPath}`;
      issues.push({
        code: "CONTEXT_ARTIFACT_INCONSISTENT",
        fieldPath: prefixedFieldPath,
        message: `ContextCapsule and RetrievalAuditRecord are inconsistent at "${prefixedFieldPath}".`,
        details: consistencyIssue
      });
    }
  }
}

interface PairValidationEntry {
  pair: LoadedContextArtifactPairV1;
  role: ContextRole;
  label: string;
}

function validatePairsInOrder(entries: PairValidationEntry[], issues: V043StageContextStrategyExecutionIssue[]): void {
  for (const entry of entries) {
    validateRole(entry.pair, entry.role, entry.label, issues);
    checkPairConsistency(entry.pair, entry.label, issues);
  }
}

export async function loadV043StrategyArtifacts(
  input: V043StageContextStrategyInputV1
): Promise<V043StageContextStrategyExecutionResult> {
  const issues: V043StageContextStrategyExecutionIssue[] = [];

  const expectationsResult = await readStageContextExpectationFixtureV1(input.expectationsPath);
  if (!expectationsResult.ok) {
    issues.push({
      code: "EXPECTATION_READ_FAILED",
      fieldPath: "expectations",
      message: `Failed to read stage-context expectation fixture: ${expectationsResult.message}`,
      sourcePath: expectationsResult.sourcePath,
      details: expectationsResult
    });
  }

  switch (input.strategyId) {
    case "architecture-context-only": {
      const architecture = await loadContextArtifactPair(
        "architecture",
        input.architectureContextCapsulePath,
        input.architectureRetrievalAuditRecordPath,
        "architecture",
        issues
      );
      const entries: PairValidationEntry[] = [];
      if (architecture) entries.push({ pair: architecture, role: "architecture", label: "architecture" });
      validatePairsInOrder(entries, issues);

      if (issues.length > 0 || !expectationsResult.ok || !architecture) {
        return buildFailureResult(input, issues);
      }
      return {
        status: "completed",
        strategyId: input.strategyId,
        input,
        expectationsSourcePath: expectationsResult.sourcePath,
        expectations: expectationsResult.fixture,
        payload: { architecture },
        warnings: []
      };
    }

    case "architecture-plus-implementation-refresh": {
      const architecture = await loadContextArtifactPair(
        "architecture",
        input.architectureContextCapsulePath,
        input.architectureRetrievalAuditRecordPath,
        "architecture",
        issues
      );
      const implementation = await loadContextArtifactPair(
        "implementation",
        input.implementationContextCapsulePath,
        input.implementationRetrievalAuditRecordPath,
        "implementation",
        issues
      );
      const entries: PairValidationEntry[] = [];
      if (architecture) entries.push({ pair: architecture, role: "architecture", label: "architecture" });
      if (implementation) entries.push({ pair: implementation, role: "implementation", label: "implementation" });
      validatePairsInOrder(entries, issues);

      if (issues.length > 0 || !expectationsResult.ok || !architecture || !implementation) {
        return buildFailureResult(input, issues);
      }
      return {
        status: "completed",
        strategyId: input.strategyId,
        input,
        expectationsSourcePath: expectationsResult.sourcePath,
        expectations: expectationsResult.fixture,
        payload: { architecture, implementation },
        warnings: []
      };
    }

    case "architecture-plus-implementation-and-test-refresh": {
      const architecture = await loadContextArtifactPair(
        "architecture",
        input.architectureContextCapsulePath,
        input.architectureRetrievalAuditRecordPath,
        "architecture",
        issues
      );
      const implementation = await loadContextArtifactPair(
        "implementation",
        input.implementationContextCapsulePath,
        input.implementationRetrievalAuditRecordPath,
        "implementation",
        issues
      );
      const testImplementation = await loadContextArtifactPair(
        "test-implementation",
        input.testImplementationContextCapsulePath,
        input.testImplementationRetrievalAuditRecordPath,
        "testImplementation",
        issues
      );
      const entries: PairValidationEntry[] = [];
      if (architecture) entries.push({ pair: architecture, role: "architecture", label: "architecture" });
      if (implementation) entries.push({ pair: implementation, role: "implementation", label: "implementation" });
      if (testImplementation) {
        entries.push({ pair: testImplementation, role: "test-implementation", label: "testImplementation" });
      }
      validatePairsInOrder(entries, issues);

      if (issues.length > 0 || !expectationsResult.ok || !architecture || !implementation || !testImplementation) {
        return buildFailureResult(input, issues);
      }
      return {
        status: "completed",
        strategyId: input.strategyId,
        input,
        expectationsSourcePath: expectationsResult.sourcePath,
        expectations: expectationsResult.fixture,
        payload: { architecture, implementation, testImplementation },
        warnings: []
      };
    }

    case "full-workflow-library": {
      const libraryResult = await readV043FullWorkflowLibraryFixture(input.fullWorkflowLibraryFixturePath);
      if (!libraryResult.ok) {
        issues.push({
          code: "FULL_WORKFLOW_LIBRARY_READ_FAILED",
          fieldPath: "fullWorkflowLibrary",
          message: `Failed to read full-workflow-library fixture: ${libraryResult.message}`,
          sourcePath: libraryResult.sourcePath,
          details: libraryResult
        });
      }

      if (issues.length > 0 || !expectationsResult.ok || !libraryResult.ok) {
        return buildFailureResult(input, issues);
      }
      return {
        status: "completed",
        strategyId: input.strategyId,
        input,
        expectationsSourcePath: expectationsResult.sourcePath,
        expectations: expectationsResult.fixture,
        payload: {
          fullWorkflowLibrarySourcePath: libraryResult.sourcePath,
          fullWorkflowLibrary: libraryResult.fixture
        },
        warnings: []
      };
    }

    case "bounded-workflow-instruction-packet": {
      const packetResult = await readOrchestratorWorkflowInstructionPacketV1(input.workflowInstructionPacketPath);
      if (!packetResult.ok) {
        issues.push({
          code: "WORKFLOW_PACKET_READ_FAILED",
          fieldPath: "workflowInstructionPacket",
          message: `Failed to read WorkflowInstructionPacket: ${packetResult.message}`,
          sourcePath: packetResult.sourcePath,
          details: packetResult
        });
      }

      if (issues.length > 0 || !expectationsResult.ok || !packetResult.ok) {
        return buildFailureResult(input, issues);
      }
      return {
        status: "completed",
        strategyId: input.strategyId,
        input,
        expectationsSourcePath: expectationsResult.sourcePath,
        expectations: expectationsResult.fixture,
        payload: {
          workflowInstructionPacketSourcePath: packetResult.sourcePath,
          workflowInstructionPacket: packetResult.artifact
        },
        warnings: []
      };
    }

    case "combined-bounded-stage-context": {
      const pairs: LoadedContextArtifactPairV1[] = [];
      const entries: PairValidationEntry[] = [];
      for (let index = 0; index < input.contextArtifacts.length; index += 1) {
        const contextArtifact = input.contextArtifacts[index];
        const pairLabel = `contextArtifacts[${index}]`;
        const pair = await loadContextArtifactPair(
          contextArtifact.role,
          contextArtifact.contextCapsulePath,
          contextArtifact.retrievalAuditRecordPath,
          pairLabel,
          issues
        );
        if (pair) {
          pairs.push(pair);
          entries.push({ pair, role: contextArtifact.role, label: pairLabel });
        }
      }
      validatePairsInOrder(entries, issues);

      const packetResult = await readOrchestratorWorkflowInstructionPacketV1(input.workflowInstructionPacketPath);
      if (!packetResult.ok) {
        issues.push({
          code: "WORKFLOW_PACKET_READ_FAILED",
          fieldPath: "workflowInstructionPacket",
          message: `Failed to read WorkflowInstructionPacket: ${packetResult.message}`,
          sourcePath: packetResult.sourcePath,
          details: packetResult
        });
      }

      // v0.4.4 Batch 3: producer-readiness bridge inputs -- every one is optional (section
      // 11.2). Only a supplied-but-unreadable source becomes a load failure; an absent
      // source is simply left off the payload for the bridge evaluator to treat as
      // unavailable/not-applicable.
      let implementationContextPacketSourcePath: string | undefined;
      let implementationContextPacket: CombinedBoundedStageContextExecutionPayloadV1["implementationContextPacket"];
      if (input.implementationContextPacketPath !== undefined) {
        const result = await readImplementationContextPacketV1(input.implementationContextPacketPath);
        if (!result.ok) {
          issues.push({
            code: "IMPLEMENTATION_CONTEXT_PACKET_READ_FAILED",
            fieldPath: "implementationContextPacket",
            message: `Failed to read implementation-context packet: ${result.message}`,
            sourcePath: result.sourcePath,
            details: result
          });
        } else {
          implementationContextPacketSourcePath = result.sourcePath;
          implementationContextPacket = result.artifact;
        }
      }

      let implementationContextRetrievalReportSourcePath: string | undefined;
      let implementationContextRetrievalReport: CombinedBoundedStageContextExecutionPayloadV1["implementationContextRetrievalReport"];
      if (input.implementationContextRetrievalReportPath !== undefined) {
        const result = await readImplementationContextRetrievalReportV1(input.implementationContextRetrievalReportPath);
        if (!result.ok) {
          issues.push({
            code: "IMPLEMENTATION_CONTEXT_RETRIEVAL_REPORT_READ_FAILED",
            fieldPath: "implementationContextRetrievalReport",
            message: `Failed to read implementation-context retrieval report: ${result.message}`,
            sourcePath: result.sourcePath,
            details: result
          });
        } else {
          implementationContextRetrievalReportSourcePath = result.sourcePath;
          implementationContextRetrievalReport = result.artifact;
        }
      }

      let testContextPacketSourcePath: string | undefined;
      let testContextPacket: CombinedBoundedStageContextExecutionPayloadV1["testContextPacket"];
      if (input.testContextPacketPath !== undefined) {
        const result = await readTestContextPacketV1(input.testContextPacketPath);
        if (!result.ok) {
          issues.push({
            code: "TEST_CONTEXT_PACKET_READ_FAILED",
            fieldPath: "testContextPacket",
            message: `Failed to read test-context packet: ${result.message}`,
            sourcePath: result.sourcePath,
            details: result
          });
        } else {
          testContextPacketSourcePath = result.sourcePath;
          testContextPacket = result.artifact;
        }
      }

      let testContextRetrievalReportSourcePath: string | undefined;
      let testContextRetrievalReport: CombinedBoundedStageContextExecutionPayloadV1["testContextRetrievalReport"];
      if (input.testContextRetrievalReportPath !== undefined) {
        const result = await readTestContextRetrievalReportV1(input.testContextRetrievalReportPath);
        if (!result.ok) {
          issues.push({
            code: "TEST_CONTEXT_RETRIEVAL_REPORT_READ_FAILED",
            fieldPath: "testContextRetrievalReport",
            message: `Failed to read test-context retrieval report: ${result.message}`,
            sourcePath: result.sourcePath,
            details: result
          });
        } else {
          testContextRetrievalReportSourcePath = result.sourcePath;
          testContextRetrievalReport = result.artifact;
        }
      }

      let readiness: CombinedBoundedStageContextExecutionPayloadV1["readiness"];
      if (input.readiness !== undefined) {
        const readinessResult = validateOrchestratorContextReadinessResultV1(input.readiness, "programmatic-input:readiness");
        if (!readinessResult.ok) {
          issues.push({
            code: "READINESS_INPUT_INVALID",
            fieldPath: "readiness",
            message: `Readiness programmatic input is invalid: ${readinessResult.message}`,
            details: readinessResult
          });
        } else {
          readiness = readinessResult.artifact;
        }
      }

      if (issues.length > 0 || !expectationsResult.ok || !packetResult.ok || pairs.length !== input.contextArtifacts.length) {
        return buildFailureResult(input, issues);
      }
      const payload: CombinedBoundedStageContextExecutionPayloadV1 = {
        contextArtifacts: pairs,
        workflowInstructionPacketSourcePath: packetResult.sourcePath,
        workflowInstructionPacket: packetResult.artifact
      };
      if (implementationContextPacket !== undefined) {
        payload.implementationContextPacketSourcePath = implementationContextPacketSourcePath;
        payload.implementationContextPacket = implementationContextPacket;
      }
      if (implementationContextRetrievalReport !== undefined) {
        payload.implementationContextRetrievalReportSourcePath = implementationContextRetrievalReportSourcePath;
        payload.implementationContextRetrievalReport = implementationContextRetrievalReport;
      }
      if (testContextPacket !== undefined) {
        payload.testContextPacketSourcePath = testContextPacketSourcePath;
        payload.testContextPacket = testContextPacket;
      }
      if (testContextRetrievalReport !== undefined) {
        payload.testContextRetrievalReportSourcePath = testContextRetrievalReportSourcePath;
        payload.testContextRetrievalReport = testContextRetrievalReport;
      }
      if (readiness !== undefined) {
        payload.readiness = readiness;
      }
      return {
        status: "completed",
        strategyId: input.strategyId,
        input,
        expectationsSourcePath: expectationsResult.sourcePath,
        expectations: expectationsResult.fixture,
        payload,
        warnings: []
      };
    }
  }
}
