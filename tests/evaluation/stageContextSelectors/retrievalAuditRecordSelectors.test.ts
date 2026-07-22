import { describe, expect, it } from "vitest";
import { readMyDevKitRetrievalAuditRecordV1 } from "../../../src/evaluation/upstreamArtifacts/readMyDevKitRetrievalAuditRecordV1.js";
import type { RetrievalAuditRecord } from "../../../src/evaluation/upstreamArtifacts/index.js";
import * as selectors from "../../../src/evaluation/stageContextSelectors/retrievalAuditRecordSelectors.js";

const COMPLETE_PATH = "tests/fixtures/upstream-artifacts/my-dev-kit/1.10.2/retrieval-audit-record/complete-v1.0.0.json";

interface SelectorCase {
  name: string;
  select: (artifact: RetrievalAuditRecord) => unknown;
  expected: (artifact: RetrievalAuditRecord) => unknown;
}

const SELECTOR_CASES: SelectorCase[] = [
  {
    name: "selectRetrievalAuditRecordSchemaVersion",
    select: selectors.selectRetrievalAuditRecordSchemaVersion,
    expected: (a) => a.schemaVersion
  },
  {
    name: "selectRetrievalAuditRecordGeneratedAt",
    select: selectors.selectRetrievalAuditRecordGeneratedAt,
    expected: (a) => a.generatedAt
  },
  { name: "selectRetrievalAuditRecordTool", select: selectors.selectRetrievalAuditRecordTool, expected: (a) => a.tool },
  { name: "selectRetrievalAuditRecordRequest", select: selectors.selectRetrievalAuditRecordRequest, expected: (a) => a.request },
  { name: "selectRetrievalAuditRecordIndex", select: selectors.selectRetrievalAuditRecordIndex, expected: (a) => a.index },
  { name: "selectRetrievalAuditRecordSteps", select: selectors.selectRetrievalAuditRecordSteps, expected: (a) => a.steps },
  { name: "selectRetrievalAuditRecordFallbacks", select: selectors.selectRetrievalAuditRecordFallbacks, expected: (a) => a.fallbacks },
  {
    name: "selectRetrievalAuditRecordFullFileReadRecommendations",
    select: selectors.selectRetrievalAuditRecordFullFileReadRecommendations,
    expected: (a) => a.fullFileReadRecommendations
  },
  { name: "selectRetrievalAuditRecordWarnings", select: selectors.selectRetrievalAuditRecordWarnings, expected: (a) => a.warnings },
  {
    name: "selectRetrievalAuditRecordContextAdequacy",
    select: selectors.selectRetrievalAuditRecordContextAdequacy,
    expected: (a) => a.contextAdequacy
  },
  {
    name: "selectRetrievalAuditRecordRoleContext",
    select: selectors.selectRetrievalAuditRecordRoleContext,
    expected: (a) => a.roleContext
  },
  {
    name: "selectRetrievalAuditRecordResponsibilityMappings",
    select: selectors.selectRetrievalAuditRecordResponsibilityMappings,
    expected: (a) => a.responsibilityMappings
  },
  {
    name: "selectRetrievalAuditRecordRoleAdequacy",
    select: selectors.selectRetrievalAuditRecordRoleAdequacy,
    expected: (a) => a.roleAdequacy
  },
  { name: "selectRetrievalAuditRecordFreshness", select: selectors.selectRetrievalAuditRecordFreshness, expected: (a) => a.freshness },
  { name: "selectRetrievalAuditRecordBudget", select: selectors.selectRetrievalAuditRecordBudget, expected: (a) => a.budget },
  {
    name: "selectRetrievalAuditRecordTruncation",
    select: selectors.selectRetrievalAuditRecordTruncation,
    expected: (a) => a.truncation
  },
  {
    name: "selectRetrievalAuditRecordFullFileFallback",
    select: selectors.selectRetrievalAuditRecordFullFileFallback,
    expected: (a) => a.fullFileFallback
  },
  {
    name: "selectRetrievalAuditRecordProvenance",
    select: selectors.selectRetrievalAuditRecordProvenance,
    expected: (a) => a.provenance
  }
];

async function loadArtifact(): Promise<RetrievalAuditRecord> {
  const result = await readMyDevKitRetrievalAuditRecordV1(COMPLETE_PATH);
  if (!result.ok) throw new Error("fixture read failed unexpectedly");
  return result.artifact;
}

describe("retrievalAuditRecordSelectors", () => {
  it("reads the complete fixture successfully", async () => {
    const result = await readMyDevKitRetrievalAuditRecordV1(COMPLETE_PATH);
    expect(result.ok).toBe(true);
  });

  it.each(SELECTOR_CASES)("$name returns the exact field value", async ({ select, expected }) => {
    const artifact = await loadArtifact();
    expect(select(artifact)).toBe(expected(artifact));
  });

  it("selectRetrievalAuditRecordSteps returns exact AuditStep objects with inputs and outputs preserved", async () => {
    const artifact = await loadArtifact();
    const steps = selectors.selectRetrievalAuditRecordSteps(artifact);
    expect(steps).toBe(artifact.steps);
    for (let i = 0; i < steps.length; i += 1) {
      expect(steps[i]).toBe(artifact.steps[i]);
      expect(steps[i].inputs).toBe(artifact.steps[i].inputs);
      expect(steps[i].outputs).toBe(artifact.steps[i].outputs);
    }
  });

  it("selectRetrievalAuditRecordFallbacks and selectRetrievalAuditRecordFullFileReadRecommendations remain arrays", async () => {
    const artifact = await loadArtifact();
    expect(Array.isArray(selectors.selectRetrievalAuditRecordFallbacks(artifact))).toBe(true);
    expect(Array.isArray(selectors.selectRetrievalAuditRecordFullFileReadRecommendations(artifact))).toBe(true);
  });

  it("selectRetrievalAuditRecordFullFileFallback preserves the exact object with a numeric used field", async () => {
    const artifact = await loadArtifact();
    const fullFileFallback = selectors.selectRetrievalAuditRecordFullFileFallback(artifact);
    expect(fullFileFallback).toBe(artifact.fullFileFallback);
    expect(typeof fullFileFallback.used).toBe("number");
  });

  it("selectRetrievalAuditRecordContextAdequacy and selectRetrievalAuditRecordRoleAdequacy remain separate", async () => {
    const artifact = await loadArtifact();
    const contextAdequacy = selectors.selectRetrievalAuditRecordContextAdequacy(artifact);
    const roleAdequacy = selectors.selectRetrievalAuditRecordRoleAdequacy(artifact);
    expect(contextAdequacy).toBe(artifact.contextAdequacy);
    expect(roleAdequacy).toBe(artifact.roleAdequacy);
    expect(contextAdequacy).not.toBe(roleAdequacy);
  });

  it("selectRetrievalAuditRecordFreshness preserves state, a single reason string, and an ordered comparedIdentities array", async () => {
    const artifact = await loadArtifact();
    const freshness = selectors.selectRetrievalAuditRecordFreshness(artifact);
    expect(freshness).toBe(artifact.freshness);
    expect(freshness.state).toBe("fresh");
    expect(typeof freshness.reason).toBe("string");
    expect(freshness.comparedIdentities).toBe(artifact.freshness.comparedIdentities);
  });

  it("no candidate-detail selector exists", () => {
    const exported = selectors as unknown as Record<string, unknown>;
    expect(exported.selectRetrievalAuditRecordCandidateFiles).toBeUndefined();
    expect(exported.selectRetrievalAuditRecordCandidateNodes).toBeUndefined();
    expect(exported.selectRetrievalAuditRecordSelectedGraph).toBeUndefined();
    expect(exported.selectRetrievalAuditRecordSelectedSource).toBeUndefined();
    expect(exported.selectRetrievalAuditRecordEvidenceGroups).toBeUndefined();
  });

  it("no unnecessary-read selector exists", () => {
    const exported = selectors as unknown as Record<string, unknown>;
    expect(exported.selectRetrievalAuditRecordUnnecessaryReads).toBeUndefined();
    expect(exported.selectRetrievalAuditRecordConsideredButUnselectedReads).toBeUndefined();
  });

  it("no selector mutates the artifact", async () => {
    const artifact = await loadArtifact();
    const before = JSON.stringify(artifact);
    for (const { select } of SELECTOR_CASES) select(artifact);
    expect(JSON.stringify(artifact)).toBe(before);
  });
});
