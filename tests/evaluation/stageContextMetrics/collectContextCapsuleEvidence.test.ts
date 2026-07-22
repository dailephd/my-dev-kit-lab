import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { readMyDevKitContextCapsuleV1 } from "../../../src/evaluation/upstreamArtifacts/index.js";
import { collectContextCapsuleEvidence } from "../../../src/evaluation/stageContextMetrics/collectContextCapsuleEvidence.js";
import type { ContextCapsule } from "../../../src/evaluation/upstreamArtifacts/index.js";

const CAPSULE_FIXTURE_PATH = "tests/fixtures/upstream-artifacts/my-dev-kit/1.10.2/context-capsule/complete-v1.0.0.json";

async function loadCapsule(): Promise<ContextCapsule> {
  const result = await readMyDevKitContextCapsuleV1(CAPSULE_FIXTURE_PATH);
  if (!result.ok) throw new Error("fixture read failed unexpectedly");
  return result.artifact;
}

describe("collectContextCapsuleEvidence", () => {
  it("MET-013 retained candidateFiles produce file evidence", async () => {
    const artifact = await loadCapsule();
    const evidence = collectContextCapsuleEvidence(artifact, "instance");
    expect(evidence.some((e) => e.category === "file" && e.targetKey === "context-capsule|file|path:src/example.ts")).toBe(true);
  });

  it("MET-014 unretained candidateFiles do not produce file evidence", async () => {
    const artifact = await loadCapsule();
    artifact.candidateFiles = [{ ...artifact.candidateFiles[0], path: "src/unretained.ts", retained: false }];
    const evidence = collectContextCapsuleEvidence(artifact, "instance");
    expect(evidence.some((e) => e.targetKey === "context-capsule|file|path:src/unretained.ts")).toBe(false);
  });

  it("MET-015 selectedGraph filePath produces file evidence", async () => {
    const artifact = await loadCapsule();
    artifact.selectedGraph.nodes[0].filePath = "src/graph-node-only.ts";
    const evidence = collectContextCapsuleEvidence(artifact, "instance");
    expect(
      evidence.some(
        (e) => e.category === "file" && e.sourceFieldPath === "selectedGraph.nodes[0].filePath" && e.targetKey === "context-capsule|file|path:src/graph-node-only.ts"
      )
    ).toBe(true);
  });

  it("MET-016 selectedSource slices produce file evidence", async () => {
    const artifact = await loadCapsule();
    artifact.selectedSource.slices[0].filePath = "src/source-slice-only.ts";
    const evidence = collectContextCapsuleEvidence(artifact, "instance");
    expect(evidence.some((e) => e.sourceFieldPath === "selectedSource.slices[0].filePath" && e.targetKey === "context-capsule|file|path:src/source-slice-only.ts")).toBe(true);
  });

  it("MET-017 selectedSourceBundles blocks produce file evidence", async () => {
    const artifact = await loadCapsule();
    artifact.selectedSourceBundles.bundles[0].blocks[0].filePath = "src/bundle-block-only.ts";
    const evidence = collectContextCapsuleEvidence(artifact, "instance");
    expect(
      evidence.some(
        (e) => e.sourceFieldPath === "selectedSourceBundles.bundles[0].blocks[0].filePath" && e.targetKey === "context-capsule|file|path:src/bundle-block-only.ts"
      )
    ).toBe(true);
  });

  it("MET-018 changedSurface files produce file evidence", async () => {
    const artifact = await loadCapsule();
    artifact.roleContext.changedSurface.files[0].path = "src/changed-surface-only.ts";
    const evidence = collectContextCapsuleEvidence(artifact, "instance");
    expect(
      evidence.some(
        (e) => e.sourceFieldPath === "roleContext.changedSurface.files[0].path" && e.targetKey === "context-capsule|file|path:src/changed-surface-only.ts"
      )
    ).toBe(true);
  });

  it("MET-019 EvidenceItemRef path produces file evidence", async () => {
    const artifact = await loadCapsule();
    artifact.evidenceGroups[0].items[0].path = "src/evidence-item-only.ts";
    const evidence = collectContextCapsuleEvidence(artifact, "instance");
    expect(
      evidence.some(
        (e) => e.sourceFieldPath === "evidenceGroups[0].items[0].path" && e.targetKey === "context-capsule|file|path:src/evidence-item-only.ts"
      )
    ).toBe(true);
  });

  it("MET-020 EvidenceItemRef sourceLocation.filePath produces file evidence", async () => {
    const artifact = await loadCapsule();
    artifact.evidenceGroups[0].items[0].sourceLocation = { filePath: "src/evidence-source-location-only.ts", line: 1 };
    const evidence = collectContextCapsuleEvidence(artifact, "instance");
    expect(
      evidence.some(
        (e) =>
          e.sourceFieldPath === "evidenceGroups[0].items[0].sourceLocation.filePath" &&
          e.targetKey === "context-capsule|file|path:src/evidence-source-location-only.ts"
      )
    ).toBe(true);
  });

  it("MET-021 selectedTests produces test-file evidence", async () => {
    const artifact = await loadCapsule();
    const evidence = collectContextCapsuleEvidence(artifact, "instance");
    expect(
      evidence.some((e) => e.category === "test-file" && e.targetKey === "context-capsule|test-file|path:tests/example.spec.ts")
    ).toBe(true);
  });

  it("MET-022 relatedTests produces test-file evidence", async () => {
    const artifact = await loadCapsule();
    artifact.testInfrastructure.relatedTests[0].path = "tests/related-only.spec.ts";
    const evidence = collectContextCapsuleEvidence(artifact, "instance");
    expect(
      evidence.some(
        (e) =>
          e.category === "test-file" &&
          e.sourceFieldPath.startsWith("testInfrastructure.relatedTests") &&
          e.targetKey === "context-capsule|test-file|path:tests/related-only.spec.ts"
      )
    ).toBe(true);
  });

  it("MET-023 fixtures produces fixture evidence", async () => {
    const artifact = await loadCapsule();
    artifact.testInfrastructure = {
      ...artifact.testInfrastructure,
      fixtures: [{ id: "fixtures/a.json", itemKind: "fixture", path: "fixtures/a.json", relationship: "fixture", basis: "test", provenance: "test" }]
    };
    const evidence = collectContextCapsuleEvidence(artifact, "instance");
    expect(evidence.some((e) => e.category === "fixture" && e.targetKey === "context-capsule|fixture|path:fixtures/a.json")).toBe(true);
  });

  it("MET-024 factories produces factory evidence", async () => {
    const artifact = await loadCapsule();
    artifact.testInfrastructure = {
      ...artifact.testInfrastructure,
      factories: [{ id: "factories/a.ts", itemKind: "factory", path: "factories/a.ts", relationship: "factory", basis: "test", provenance: "test" }]
    };
    const evidence = collectContextCapsuleEvidence(artifact, "instance");
    expect(evidence.some((e) => e.category === "factory" && e.targetKey === "context-capsule|factory|path:factories/a.ts")).toBe(true);
  });

  it("MET-025 mocks produces mock evidence", async () => {
    const artifact = await loadCapsule();
    artifact.testInfrastructure = {
      ...artifact.testInfrastructure,
      mocks: [{ id: "mocks/a.ts", itemKind: "mock", path: "mocks/a.ts", relationship: "mock", basis: "test", provenance: "test" }]
    };
    const evidence = collectContextCapsuleEvidence(artifact, "instance");
    expect(evidence.some((e) => e.category === "mock" && e.targetKey === "context-capsule|mock|path:mocks/a.ts")).toBe(true);
  });

  it("MET-026 setupFiles produces setup-file evidence", async () => {
    const artifact = await loadCapsule();
    artifact.testInfrastructure = {
      ...artifact.testInfrastructure,
      setupFiles: [{ id: "setup.ts", itemKind: "setup-file", path: "setup.ts", relationship: "setup", basis: "test", provenance: "test" }]
    };
    const evidence = collectContextCapsuleEvidence(artifact, "instance");
    expect(evidence.some((e) => e.category === "setup-file" && e.targetKey === "context-capsule|setup-file|path:setup.ts")).toBe(true);
  });

  it("MET-027 testConfigurations produces test-configuration evidence", async () => {
    const artifact = await loadCapsule();
    const evidence = collectContextCapsuleEvidence(artifact, "instance");
    expect(
      evidence.some(
        (e) => e.category === "test-configuration" && e.targetKey === "context-capsule|test-configuration|path:vitest.config.ts"
      )
    ).toBe(true);
  });

  it("MET-028 CandidateNode produces symbol evidence only when retained", async () => {
    const artifact = await loadCapsule();
    artifact.candidateNodes = [
      { ...artifact.candidateNodes[0], nodeId: "symbol:retained", retained: true },
      { ...artifact.candidateNodes[0], nodeId: "symbol:unretained", retained: false }
    ];
    const evidence = collectContextCapsuleEvidence(artifact, "instance");
    expect(evidence.some((e) => e.targetKey === "context-capsule|symbol|symbolId:symbol:retained")).toBe(true);
    expect(evidence.some((e) => e.targetKey === "context-capsule|symbol|symbolId:symbol:unretained")).toBe(false);
  });

  it("MET-029 selectedGraph nodes produce symbol evidence", async () => {
    const artifact = await loadCapsule();
    artifact.selectedGraph.nodes[0].nodeId = "symbol:graph-node-only";
    const evidence = collectContextCapsuleEvidence(artifact, "instance");
    expect(
      evidence.some(
        (e) =>
          e.category === "symbol" &&
          e.sourceFieldPath === "selectedGraph.nodes[0].nodeId" &&
          e.targetKey === "context-capsule|symbol|symbolId:symbol:graph-node-only"
      )
    ).toBe(true);
  });

  it("MET-030 EvidenceItemRef symbolId is collected before nodeId", async () => {
    const artifact = await loadCapsule();
    artifact.evidenceGroups[0].items[0].symbolId = "symbol:distinct-symbol-id";
    artifact.evidenceGroups[0].items[0].nodeId = "symbol:distinct-node-id";
    const evidence = collectContextCapsuleEvidence(artifact, "instance");
    const symbolIdIndex = evidence.findIndex((e) => e.sourceFieldPath === "evidenceGroups[0].items[0].symbolId");
    const nodeIdIndex = evidence.findIndex((e) => e.sourceFieldPath === "evidenceGroups[0].items[0].nodeId");
    expect(symbolIdIndex).toBeGreaterThanOrEqual(0);
    expect(nodeIdIndex).toBeGreaterThan(symbolIdIndex);
  });

  it("MET-031 selectedContracts produces contract evidence", async () => {
    const artifact = await loadCapsule();
    artifact.selectedContracts = [
      { id: "contract:a", itemKind: "symbol", symbolId: "contract:a", relationship: "contract", basis: "test", provenance: "test" }
    ];
    const evidence = collectContextCapsuleEvidence(artifact, "instance");
    expect(evidence.some((e) => e.category === "contract" && e.targetKey === "context-capsule|contract|symbolId:contract:a")).toBe(true);
  });

  it("MET-032 responsibility contracts produce contract evidence", async () => {
    const artifact = await loadCapsule();
    artifact.responsibilityMappings.mappings[0].contracts = [
      { id: "contract:resp", itemKind: "symbol", symbolId: "contract:resp", relationship: "contract", basis: "test", provenance: "test" }
    ];
    const evidence = collectContextCapsuleEvidence(artifact, "instance");
    expect(evidence.some((e) => e.category === "contract" && e.targetKey === "context-capsule|contract|symbolId:contract:resp")).toBe(true);
  });

  it("MET-033 responsibility validators produce validator evidence", async () => {
    const artifact = await loadCapsule();
    artifact.responsibilityMappings.mappings[0].validators = [
      { id: "validator:a", itemKind: "symbol", symbolId: "validator:a", relationship: "validator", basis: "test", provenance: "test" }
    ];
    const evidence = collectContextCapsuleEvidence(artifact, "instance");
    expect(evidence.some((e) => e.category === "validator" && e.targetKey === "context-capsule|validator|symbolId:validator:a")).toBe(true);
  });

  it("MET-034 responsibility constants produce constant evidence", async () => {
    const artifact = await loadCapsule();
    artifact.responsibilityMappings.mappings[0].constants = [
      { id: "constant:a", itemKind: "symbol", symbolId: "constant:a", relationship: "constant", basis: "test", provenance: "test" }
    ];
    const evidence = collectContextCapsuleEvidence(artifact, "instance");
    expect(evidence.some((e) => e.category === "constant" && e.targetKey === "context-capsule|constant|symbolId:constant:a")).toBe(true);
  });

  it("MET-035 responsibility errors produce error evidence", async () => {
    const artifact = await loadCapsule();
    artifact.responsibilityMappings.mappings[0].errors = [
      { id: "error:a", itemKind: "symbol", symbolId: "error:a", relationship: "error", basis: "test", provenance: "test" }
    ];
    const evidence = collectContextCapsuleEvidence(artifact, "instance");
    expect(evidence.some((e) => e.category === "error" && e.targetKey === "context-capsule|error|symbolId:error:a")).toBe(true);
  });

  it("MET-036 schema-or-serializer uses only the exact configured contract evidence", async () => {
    const artifact = await loadCapsule();
    artifact.selectedContracts = [
      { id: "schema:a", itemKind: "symbol", symbolId: "schema:a", relationship: "contract", basis: "test", provenance: "test" }
    ];
    const evidence = collectContextCapsuleEvidence(artifact, "instance");
    const schemaEvidence = evidence.filter((e) => e.category === "schema-or-serializer");
    expect(schemaEvidence.some((e) => e.targetKey === "context-capsule|schema-or-serializer|symbolId:schema:a")).toBe(true);
  });

  it("MET-037 selectedSource produces source-range evidence", async () => {
    const artifact = await loadCapsule();
    const evidence = collectContextCapsuleEvidence(artifact, "instance");
    expect(
      evidence.some(
        (e) => e.category === "source-range" && e.targetKey === "context-capsule|source-range|filePath:src/example.ts|startLine:1|endLine:10"
      )
    ).toBe(true);
  });

  it("MET-038 selectedSourceBundles produces source-range evidence", async () => {
    const artifact = await loadCapsule();
    artifact.selectedSourceBundles.bundles[0].blocks[0].filePath = "src/bundle-range-only.ts";
    artifact.selectedSourceBundles.bundles[0].blocks[0].startLine = 20;
    artifact.selectedSourceBundles.bundles[0].blocks[0].endLine = 30;
    const evidence = collectContextCapsuleEvidence(artifact, "instance");
    expect(
      evidence.some(
        (e) =>
          e.category === "source-range" &&
          e.sourceFieldPath.startsWith("selectedSourceBundles") &&
          e.targetKey === "context-capsule|source-range|filePath:src/bundle-range-only.ts|startLine:20|endLine:30"
      )
    ).toBe(true);
  });

  it("MET-039 responsibility IDs produce production-responsibility evidence", async () => {
    const artifact = await loadCapsule();
    const evidence = collectContextCapsuleEvidence(artifact, "instance");
    expect(
      evidence.some(
        (e) =>
          e.category === "production-responsibility" &&
          e.targetKey === "context-capsule|production-responsibility|responsibilityId:fixture.responsibility.001"
      )
    ).toBe(true);
  });

  it("MET-040 package script names produce package-script evidence", async () => {
    const artifact = await loadCapsule();
    const evidence = collectContextCapsuleEvidence(artifact, "instance");
    expect(evidence.some((e) => e.category === "package-script" && e.targetKey === "context-capsule|package-script|name:test")).toBe(true);
  });

  it("MET-041 non-null commandText produces test-command evidence", async () => {
    const artifact = await loadCapsule();
    const evidence = collectContextCapsuleEvidence(artifact, "instance");
    expect(
      evidence.some(
        (e) =>
          e.category === "test-command" &&
          e.targetKey === "context-capsule|test-command|commandText:vitest run tests/example.spec.ts"
      )
    ).toBe(true);
  });

  it("MET-042 null commandText is skipped", async () => {
    const artifact = await loadCapsule();
    const evidence = collectContextCapsuleEvidence(artifact, "instance");
    const commandEvidence = evidence.filter((e) => e.category === "test-command");
    expect(commandEvidence).toHaveLength(1);
  });

  it("MET-043 provenance evidenceId produces provenance evidence", async () => {
    const artifact = await loadCapsule();
    const evidence = collectContextCapsuleEvidence(artifact, "instance");
    expect(
      evidence.some(
        (e) =>
          e.category === "provenance" &&
          e.targetKey === "context-capsule|provenance|evidenceId:symbol:src/example.ts#Example"
      )
    ).toBe(true);
  });

  it("MET-044 dropped context does not produce evidence", async () => {
    const artifact = await loadCapsule();
    const evidence = collectContextCapsuleEvidence(artifact, "instance");
    expect(evidence.some((e) => e.targetKey.includes("fixture.context.dropped"))).toBe(false);
  });

  it("MET-045 collection order follows Sections 25-31", async () => {
    const artifact = await loadCapsule();
    const evidence = collectContextCapsuleEvidence(artifact, "instance");
    const firstFileIndex = evidence.findIndex((e) => e.category === "file");
    const firstTestFileIndex = evidence.findIndex((e) => e.category === "test-file");
    const firstSymbolIndex = evidence.findIndex((e) => e.category === "symbol");
    const firstSourceRangeIndex = evidence.findIndex((e) => e.category === "source-range");
    const firstResponsibilityIndex = evidence.findIndex((e) => e.category === "production-responsibility");
    const firstPackageScriptIndex = evidence.findIndex((e) => e.category === "package-script");
    const firstProvenanceIndex = evidence.findIndex((e) => e.category === "provenance");
    expect(firstFileIndex).toBeLessThan(firstTestFileIndex);
    expect(firstTestFileIndex).toBeLessThan(firstSymbolIndex);
    expect(firstSymbolIndex).toBeLessThan(firstSourceRangeIndex);
    expect(firstSourceRangeIndex).toBeLessThan(firstResponsibilityIndex);
    expect(firstResponsibilityIndex).toBeLessThan(firstPackageScriptIndex);
    expect(firstPackageScriptIndex).toBeLessThan(firstProvenanceIndex);
  });

  it("MET-046 exact duplicate records are deduplicated by first occurrence", async () => {
    const artifact = await loadCapsule();
    const evidence = collectContextCapsuleEvidence(artifact, "instance");
    const fileEvidenceForExample = evidence.filter(
      (e) => e.category === "file" && e.targetKey === "context-capsule|file|path:src/example.ts"
    );
    expect(fileEvidenceForExample).toHaveLength(1);
    expect(fileEvidenceForExample[0].sourceFieldPath).toBe("candidateFiles[0].path");
  });

  it("MET-047 records from different source instances are not deduplicated together", async () => {
    const artifact = await loadCapsule();
    const evidenceA = collectContextCapsuleEvidence(artifact, "instanceA");
    const evidenceB = collectContextCapsuleEvidence(artifact, "instanceB");
    const combined = [...evidenceA, ...evidenceB];
    const forExample = combined.filter((e) => e.category === "file" && e.targetKey === "context-capsule|file|path:src/example.ts");
    expect(forExample).toHaveLength(2);
    expect(new Set(forExample.map((e) => e.sourceInstance)).size).toBe(2);
  });

  it("MET-048 no path is normalized", async () => {
    const artifact = await loadCapsule();
    artifact.candidateFiles = [{ ...artifact.candidateFiles[0], path: "./src/../src/example.ts" }];
    const evidence = collectContextCapsuleEvidence(artifact, "instance");
    expect(evidence.some((e) => e.targetKey === "context-capsule|file|path:./src/../src/example.ts")).toBe(true);
  });

  it("MET-049 the artifact is not mutated", async () => {
    const artifact = await loadCapsule();
    const before = JSON.stringify(artifact);
    collectContextCapsuleEvidence(artifact, "instance");
    expect(JSON.stringify(artifact)).toBe(before);
  });
});
