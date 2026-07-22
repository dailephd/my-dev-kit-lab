import { describe, expect, it } from "vitest";
import { readMyDevKitContextCapsuleV1 } from "../../../src/evaluation/upstreamArtifacts/readMyDevKitContextCapsuleV1.js";
import type { ContextCapsule } from "../../../src/evaluation/upstreamArtifacts/index.js";
import * as selectors from "../../../src/evaluation/stageContextSelectors/contextCapsuleSelectors.js";

const COMPLETE_PATH = "tests/fixtures/upstream-artifacts/my-dev-kit/1.10.2/context-capsule/complete-v1.0.0.json";

interface SelectorCase {
  name: string;
  select: (artifact: ContextCapsule) => unknown;
  expected: (artifact: ContextCapsule) => unknown;
}

const SELECTOR_CASES: SelectorCase[] = [
  { name: "selectContextCapsuleSchemaVersion", select: selectors.selectContextCapsuleSchemaVersion, expected: (a) => a.schemaVersion },
  { name: "selectContextCapsuleGeneratedAt", select: selectors.selectContextCapsuleGeneratedAt, expected: (a) => a.generatedAt },
  { name: "selectContextCapsuleTool", select: selectors.selectContextCapsuleTool, expected: (a) => a.tool },
  { name: "selectContextCapsuleRequest", select: selectors.selectContextCapsuleRequest, expected: (a) => a.request },
  { name: "selectContextCapsuleIndex", select: selectors.selectContextCapsuleIndex, expected: (a) => a.index },
  { name: "selectContextCapsuleLimits", select: selectors.selectContextCapsuleLimits, expected: (a) => a.limits },
  { name: "selectContextCapsuleRequiredContext", select: selectors.selectContextCapsuleRequiredContext, expected: (a) => a.requiredContext },
  {
    name: "selectContextCapsuleOptionalSupportContext",
    select: selectors.selectContextCapsuleOptionalSupportContext,
    expected: (a) => a.optionalSupportContext
  },
  { name: "selectContextCapsuleDroppedContext", select: selectors.selectContextCapsuleDroppedContext, expected: (a) => a.droppedContext },
  { name: "selectContextCapsuleWarnings", select: selectors.selectContextCapsuleWarnings, expected: (a) => a.warnings },
  { name: "selectContextCapsuleContextAdequacy", select: selectors.selectContextCapsuleContextAdequacy, expected: (a) => a.contextAdequacy },
  { name: "selectContextCapsuleQueryPlan", select: selectors.selectContextCapsuleQueryPlan, expected: (a) => a.queryPlan },
  { name: "selectContextCapsuleCandidateFiles", select: selectors.selectContextCapsuleCandidateFiles, expected: (a) => a.candidateFiles },
  { name: "selectContextCapsuleCandidateNodes", select: selectors.selectContextCapsuleCandidateNodes, expected: (a) => a.candidateNodes },
  { name: "selectContextCapsuleFocus", select: selectors.selectContextCapsuleFocus, expected: (a) => a.focus },
  { name: "selectContextCapsuleSelectedGraph", select: selectors.selectContextCapsuleSelectedGraph, expected: (a) => a.selectedGraph },
  { name: "selectContextCapsuleRetention", select: selectors.selectContextCapsuleRetention, expected: (a) => a.retention },
  { name: "selectContextCapsuleSelectedSource", select: selectors.selectContextCapsuleSelectedSource, expected: (a) => a.selectedSource },
  {
    name: "selectContextCapsuleSelectedSourceBundles",
    select: selectors.selectContextCapsuleSelectedSourceBundles,
    expected: (a) => a.selectedSourceBundles
  },
  { name: "selectContextCapsuleSemanticSummary", select: selectors.selectContextCapsuleSemanticSummary, expected: (a) => a.semanticSummary },
  {
    name: "selectContextCapsuleClassificationSummary",
    select: selectors.selectContextCapsuleClassificationSummary,
    expected: (a) => a.classificationSummary
  },
  {
    name: "selectContextCapsuleArtifactReferenceSummary",
    select: selectors.selectContextCapsuleArtifactReferenceSummary,
    expected: (a) => a.artifactReferenceSummary
  },
  { name: "selectContextCapsulePruning", select: selectors.selectContextCapsulePruning, expected: (a) => a.pruning },
  { name: "selectContextCapsuleConflicts", select: selectors.selectContextCapsuleConflicts, expected: (a) => a.conflicts },
  { name: "selectContextCapsuleModeEffects", select: selectors.selectContextCapsuleModeEffects, expected: (a) => a.modeEffects },
  { name: "selectContextCapsuleSourceControl", select: selectors.selectContextCapsuleSourceControl, expected: (a) => a.sourceControl },
  {
    name: "selectContextCapsuleDeferredRequestFields",
    select: selectors.selectContextCapsuleDeferredRequestFields,
    expected: (a) => a.deferredRequestFields
  },
  { name: "selectContextCapsuleRoleContext", select: selectors.selectContextCapsuleRoleContext, expected: (a) => a.roleContext },
  { name: "selectContextCapsuleEvidenceGroups", select: selectors.selectContextCapsuleEvidenceGroups, expected: (a) => a.evidenceGroups },
  { name: "selectContextCapsuleSelectedOwners", select: selectors.selectContextCapsuleSelectedOwners, expected: (a) => a.selectedOwners },
  { name: "selectContextCapsuleSelectedContracts", select: selectors.selectContextCapsuleSelectedContracts, expected: (a) => a.selectedContracts },
  { name: "selectContextCapsuleSelectedTests", select: selectors.selectContextCapsuleSelectedTests, expected: (a) => a.selectedTests },
  {
    name: "selectContextCapsuleTestInfrastructure",
    select: selectors.selectContextCapsuleTestInfrastructure,
    expected: (a) => a.testInfrastructure
  },
  { name: "selectContextCapsuleUnresolvedItems", select: selectors.selectContextCapsuleUnresolvedItems, expected: (a) => a.unresolvedItems },
  { name: "selectContextCapsuleGroupTruncation", select: selectors.selectContextCapsuleGroupTruncation, expected: (a) => a.groupTruncation },
  {
    name: "selectContextCapsuleResponsibilityMappings",
    select: selectors.selectContextCapsuleResponsibilityMappings,
    expected: (a) => a.responsibilityMappings
  },
  { name: "selectContextCapsuleRoleAdequacy", select: selectors.selectContextCapsuleRoleAdequacy, expected: (a) => a.roleAdequacy },
  { name: "selectContextCapsuleFreshness", select: selectors.selectContextCapsuleFreshness, expected: (a) => a.freshness },
  { name: "selectContextCapsuleBudget", select: selectors.selectContextCapsuleBudget, expected: (a) => a.budget },
  { name: "selectContextCapsuleTruncation", select: selectors.selectContextCapsuleTruncation, expected: (a) => a.truncation },
  { name: "selectContextCapsuleFullFileFallback", select: selectors.selectContextCapsuleFullFileFallback, expected: (a) => a.fullFileFallback },
  { name: "selectContextCapsuleProvenance", select: selectors.selectContextCapsuleProvenance, expected: (a) => a.provenance }
];

async function loadArtifact(): Promise<ContextCapsule> {
  const result = await readMyDevKitContextCapsuleV1(COMPLETE_PATH);
  if (!result.ok) throw new Error("fixture read failed unexpectedly");
  return result.artifact;
}

describe("contextCapsuleSelectors", () => {
  it("reads the complete fixture successfully", async () => {
    const result = await readMyDevKitContextCapsuleV1(COMPLETE_PATH);
    expect(result.ok).toBe(true);
  });

  it.each(SELECTOR_CASES)("$name returns the exact field value", async ({ select, expected }) => {
    const artifact = await loadArtifact();
    expect(select(artifact)).toBe(expected(artifact));
  });

  it("selectContextCapsuleContextAdequacy and selectContextCapsuleRoleAdequacy return separate, unmerged objects", async () => {
    const artifact = await loadArtifact();
    const contextAdequacy = selectors.selectContextCapsuleContextAdequacy(artifact);
    const roleAdequacy = selectors.selectContextCapsuleRoleAdequacy(artifact);
    expect(contextAdequacy).toBe(artifact.contextAdequacy);
    expect(roleAdequacy).toBe(artifact.roleAdequacy);
    expect(contextAdequacy).not.toBe(roleAdequacy);
    expect((contextAdequacy as unknown as Record<string, unknown>).requiredConditions).toBeUndefined();
    expect((roleAdequacy as unknown as Record<string, unknown>).assumptions).toBeUndefined();
  });

  it("selectContextCapsuleFreshness preserves state, a single reason string, and an ordered comparedIdentities array including a null value", async () => {
    const artifact = await loadArtifact();
    const freshness = selectors.selectContextCapsuleFreshness(artifact);
    expect(freshness).toBe(artifact.freshness);
    expect(freshness.state).toBe("fresh");
    expect(typeof freshness.reason).toBe("string");
    expect(Array.isArray(freshness.comparedIdentities)).toBe(true);
    expect(freshness.comparedIdentities).toBe(artifact.freshness.comparedIdentities);
    expect(freshness.comparedIdentities.some((identity) => identity.value === null)).toBe(true);
  });

  it("selectContextCapsuleRoleContext preserves nested changedSurface", async () => {
    const artifact = await loadArtifact();
    const roleContext = selectors.selectContextCapsuleRoleContext(artifact);
    expect(roleContext).toBe(artifact.roleContext);
    expect(roleContext.changedSurface).toBe(artifact.roleContext.changedSurface);
    expect(roleContext.changedSurface.files).toBe(artifact.roleContext.changedSurface.files);
  });

  it("selectContextCapsuleDroppedContext does not report reads", async () => {
    const artifact = await loadArtifact();
    const droppedContext = selectors.selectContextCapsuleDroppedContext(artifact);
    for (const entry of droppedContext) {
      expect(entry as unknown as Record<string, unknown>).not.toHaveProperty("evidenceRefs");
    }
  });

  it("no selector changes path separators", async () => {
    const artifact = await loadArtifact();
    expect(selectors.selectContextCapsuleIndex(artifact).indexPath).toBe("Z:/fixture/project/.my-dev-kit");
  });

  it("no selector sorts an array", async () => {
    const artifact = await loadArtifact();
    const queryPlan = selectors.selectContextCapsuleQueryPlan(artifact);
    expect(queryPlan.terms.raw).toEqual(artifact.queryPlan.terms.raw);
    expect(queryPlan.terms.raw).toBe(artifact.queryPlan.terms.raw);
  });

  it("no selector mutates the artifact and no property is added or removed", async () => {
    const artifact = await loadArtifact();
    const before = JSON.stringify(artifact);
    for (const { select } of SELECTOR_CASES) select(artifact);
    const after = JSON.stringify(artifact);
    expect(after).toBe(before);
    expect(Object.keys(artifact).sort()).toEqual(Object.keys(JSON.parse(before) as object).sort());
  });
});
