import type { ContextCapsule } from "../upstreamArtifacts/index.js";
import type { StageContextExpectationCategory } from "../stageContextExpectations/index.js";
import type { StageContextObservedEvidenceV1 } from "./types.js";

const SOURCE_ARTIFACT = "context-capsule" as const;

function pathKey(category: string, path: string): string {
  return `${SOURCE_ARTIFACT}|${category}|path:${path}`;
}

function symbolKey(category: string, symbolId: string): string {
  return `${SOURCE_ARTIFACT}|${category}|symbolId:${symbolId}`;
}

function sourceRangeKey(filePath: string, startLine: number, endLine: number): string {
  return `context-capsule|source-range|filePath:${filePath}|startLine:${startLine}|endLine:${endLine}`;
}

function responsibilityKey(responsibilityId: string): string {
  return `${SOURCE_ARTIFACT}|production-responsibility|responsibilityId:${responsibilityId}`;
}

function packageScriptKey(name: string): string {
  return `context-capsule|package-script|name:${name}`;
}

function testCommandKey(commandText: string): string {
  return `context-capsule|test-command|commandText:${commandText}`;
}

function provenanceKey(evidenceId: string): string {
  return `${SOURCE_ARTIFACT}|provenance|evidenceId:${evidenceId}`;
}

interface FileLikeRef {
  path?: string;
  sourceLocation?: { filePath: string };
}

interface SymbolLikeRef {
  symbolId?: string;
  nodeId?: string;
}

function pushFileEvidenceFromRefs(
  records: StageContextObservedEvidenceV1[],
  items: readonly FileLikeRef[],
  fieldPrefix: string,
  category: StageContextExpectationCategory,
  sourceInstance: string
): void {
  items.forEach((item, index) => {
    if (item.path !== undefined) {
      records.push({
        sourceArtifact: SOURCE_ARTIFACT,
        sourceInstance,
        category,
        targetKey: pathKey(category, item.path),
        sourceFieldPath: `${fieldPrefix}[${index}].path`
      });
    }
    if (item.sourceLocation?.filePath !== undefined) {
      records.push({
        sourceArtifact: SOURCE_ARTIFACT,
        sourceInstance,
        category,
        targetKey: pathKey(category, item.sourceLocation.filePath),
        sourceFieldPath: `${fieldPrefix}[${index}].sourceLocation.filePath`
      });
    }
  });
}

function pushSymbolEvidenceFromRefs(
  records: StageContextObservedEvidenceV1[],
  items: readonly SymbolLikeRef[],
  fieldPrefix: string,
  category: StageContextExpectationCategory,
  sourceInstance: string
): void {
  items.forEach((item, index) => {
    if (item.symbolId !== undefined) {
      records.push({
        sourceArtifact: SOURCE_ARTIFACT,
        sourceInstance,
        category,
        targetKey: symbolKey(category, item.symbolId),
        sourceFieldPath: `${fieldPrefix}[${index}].symbolId`
      });
    }
    if (item.nodeId !== undefined) {
      records.push({
        sourceArtifact: SOURCE_ARTIFACT,
        sourceInstance,
        category,
        targetKey: symbolKey(category, item.nodeId),
        sourceFieldPath: `${fieldPrefix}[${index}].nodeId`
      });
    }
  });
}

function dedupeEvidence(records: StageContextObservedEvidenceV1[]): StageContextObservedEvidenceV1[] {
  const seen = new Set<string>();
  const result: StageContextObservedEvidenceV1[] = [];
  for (const record of records) {
    const key = `${record.sourceInstance} ${record.category} ${record.targetKey}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(record);
  }
  return result;
}

export function collectContextCapsuleEvidence(
  artifact: ContextCapsule,
  sourceInstance: string
): StageContextObservedEvidenceV1[] {
  const records: StageContextObservedEvidenceV1[] = [];

  // Section 25: general file evidence
  artifact.candidateFiles.forEach((candidate, index) => {
    if (candidate.retained) {
      records.push({
        sourceArtifact: SOURCE_ARTIFACT,
        sourceInstance,
        category: "file",
        targetKey: pathKey("file", candidate.path),
        sourceFieldPath: `candidateFiles[${index}].path`
      });
    }
  });
  artifact.selectedGraph.nodes.forEach((node, index) => {
    if (node.filePath !== undefined) {
      records.push({
        sourceArtifact: SOURCE_ARTIFACT,
        sourceInstance,
        category: "file",
        targetKey: pathKey("file", node.filePath),
        sourceFieldPath: `selectedGraph.nodes[${index}].filePath`
      });
    }
  });
  artifact.selectedSource.slices.forEach((slice, index) => {
    records.push({
      sourceArtifact: SOURCE_ARTIFACT,
      sourceInstance,
      category: "file",
      targetKey: pathKey("file", slice.filePath),
      sourceFieldPath: `selectedSource.slices[${index}].filePath`
    });
  });
  artifact.selectedSourceBundles.bundles.forEach((bundle, bundleIndex) => {
    bundle.blocks.forEach((block, blockIndex) => {
      records.push({
        sourceArtifact: SOURCE_ARTIFACT,
        sourceInstance,
        category: "file",
        targetKey: pathKey("file", block.filePath),
        sourceFieldPath: `selectedSourceBundles.bundles[${bundleIndex}].blocks[${blockIndex}].filePath`
      });
    });
  });
  artifact.roleContext.changedSurface.files.forEach((file, index) => {
    records.push({
      sourceArtifact: SOURCE_ARTIFACT,
      sourceInstance,
      category: "file",
      targetKey: pathKey("file", file.path),
      sourceFieldPath: `roleContext.changedSurface.files[${index}].path`
    });
  });
  artifact.evidenceGroups.forEach((group, groupIndex) => {
    pushFileEvidenceFromRefs(records, group.items, `evidenceGroups[${groupIndex}].items`, "file", sourceInstance);
  });
  pushFileEvidenceFromRefs(records, artifact.selectedOwners, "selectedOwners", "file", sourceInstance);
  pushFileEvidenceFromRefs(records, artifact.selectedContracts, "selectedContracts", "file", sourceInstance);
  pushFileEvidenceFromRefs(records, artifact.selectedTests, "selectedTests", "file", sourceInstance);
  pushFileEvidenceFromRefs(records, artifact.testInfrastructure.relatedTests, "testInfrastructure.relatedTests", "file", sourceInstance);
  pushFileEvidenceFromRefs(records, artifact.testInfrastructure.fixtures, "testInfrastructure.fixtures", "file", sourceInstance);
  pushFileEvidenceFromRefs(records, artifact.testInfrastructure.factories, "testInfrastructure.factories", "file", sourceInstance);
  pushFileEvidenceFromRefs(records, artifact.testInfrastructure.mocks, "testInfrastructure.mocks", "file", sourceInstance);
  pushFileEvidenceFromRefs(records, artifact.testInfrastructure.setupFiles, "testInfrastructure.setupFiles", "file", sourceInstance);
  artifact.testInfrastructure.testConfigurations.forEach((config, index) => {
    records.push({
      sourceArtifact: SOURCE_ARTIFACT,
      sourceInstance,
      category: "file",
      targetKey: pathKey("file", config.path),
      sourceFieldPath: `testInfrastructure.testConfigurations[${index}].path`
    });
  });
  artifact.testInfrastructure.packageScripts.forEach((script, index) => {
    records.push({
      sourceArtifact: SOURCE_ARTIFACT,
      sourceInstance,
      category: "file",
      targetKey: pathKey("file", script.packageJsonPath),
      sourceFieldPath: `testInfrastructure.packageScripts[${index}].packageJsonPath`
    });
  });
  artifact.testInfrastructure.testCommands.forEach((command, commandIndex) => {
    command.testFiles.forEach((testFile, fileIndex) => {
      records.push({
        sourceArtifact: SOURCE_ARTIFACT,
        sourceInstance,
        category: "file",
        targetKey: pathKey("file", testFile),
        sourceFieldPath: `testInfrastructure.testCommands[${commandIndex}].testFiles[${fileIndex}]`
      });
    });
  });

  // Section 26: specific path-category evidence
  pushFileEvidenceFromRefs(records, artifact.selectedTests, "selectedTests", "test-file", sourceInstance);
  pushFileEvidenceFromRefs(records, artifact.testInfrastructure.relatedTests, "testInfrastructure.relatedTests", "test-file", sourceInstance);
  artifact.testInfrastructure.testCommands.forEach((command, commandIndex) => {
    command.testFiles.forEach((testFile, fileIndex) => {
      records.push({
        sourceArtifact: SOURCE_ARTIFACT,
        sourceInstance,
        category: "test-file",
        targetKey: pathKey("test-file", testFile),
        sourceFieldPath: `testInfrastructure.testCommands[${commandIndex}].testFiles[${fileIndex}]`
      });
    });
  });
  pushFileEvidenceFromRefs(records, artifact.testInfrastructure.fixtures, "testInfrastructure.fixtures", "fixture", sourceInstance);
  pushFileEvidenceFromRefs(records, artifact.testInfrastructure.factories, "testInfrastructure.factories", "factory", sourceInstance);
  pushFileEvidenceFromRefs(records, artifact.testInfrastructure.mocks, "testInfrastructure.mocks", "mock", sourceInstance);
  pushFileEvidenceFromRefs(records, artifact.testInfrastructure.setupFiles, "testInfrastructure.setupFiles", "setup-file", sourceInstance);
  artifact.testInfrastructure.testConfigurations.forEach((config, index) => {
    records.push({
      sourceArtifact: SOURCE_ARTIFACT,
      sourceInstance,
      category: "test-configuration",
      targetKey: pathKey("test-configuration", config.path),
      sourceFieldPath: `testInfrastructure.testConfigurations[${index}].path`
    });
  });

  // Section 27: symbol and symbol-subtype evidence
  artifact.candidateNodes.forEach((node, index) => {
    if (node.retained) {
      records.push({
        sourceArtifact: SOURCE_ARTIFACT,
        sourceInstance,
        category: "symbol",
        targetKey: symbolKey("symbol", node.nodeId),
        sourceFieldPath: `candidateNodes[${index}].nodeId`
      });
    }
  });
  artifact.selectedGraph.nodes.forEach((node, index) => {
    records.push({
      sourceArtifact: SOURCE_ARTIFACT,
      sourceInstance,
      category: "symbol",
      targetKey: symbolKey("symbol", node.nodeId),
      sourceFieldPath: `selectedGraph.nodes[${index}].nodeId`
    });
  });
  artifact.evidenceGroups.forEach((group, groupIndex) => {
    pushSymbolEvidenceFromRefs(records, group.items, `evidenceGroups[${groupIndex}].items`, "symbol", sourceInstance);
  });
  pushSymbolEvidenceFromRefs(records, artifact.selectedOwners, "selectedOwners", "symbol", sourceInstance);
  pushSymbolEvidenceFromRefs(records, artifact.selectedContracts, "selectedContracts", "symbol", sourceInstance);
  pushSymbolEvidenceFromRefs(records, artifact.selectedTests, "selectedTests", "symbol", sourceInstance);
  pushSymbolEvidenceFromRefs(records, artifact.testInfrastructure.relatedTests, "testInfrastructure.relatedTests", "symbol", sourceInstance);
  pushSymbolEvidenceFromRefs(records, artifact.testInfrastructure.fixtures, "testInfrastructure.fixtures", "symbol", sourceInstance);
  pushSymbolEvidenceFromRefs(records, artifact.testInfrastructure.factories, "testInfrastructure.factories", "symbol", sourceInstance);
  pushSymbolEvidenceFromRefs(records, artifact.testInfrastructure.mocks, "testInfrastructure.mocks", "symbol", sourceInstance);
  pushSymbolEvidenceFromRefs(records, artifact.testInfrastructure.setupFiles, "testInfrastructure.setupFiles", "symbol", sourceInstance);

  pushSymbolEvidenceFromRefs(records, artifact.selectedContracts, "selectedContracts", "contract", sourceInstance);
  artifact.responsibilityMappings.mappings.forEach((mapping, mappingIndex) => {
    pushSymbolEvidenceFromRefs(
      records,
      mapping.contracts,
      `responsibilityMappings.mappings[${mappingIndex}].contracts`,
      "contract",
      sourceInstance
    );
  });
  artifact.responsibilityMappings.mappings.forEach((mapping, mappingIndex) => {
    pushSymbolEvidenceFromRefs(
      records,
      mapping.validators,
      `responsibilityMappings.mappings[${mappingIndex}].validators`,
      "validator",
      sourceInstance
    );
  });
  artifact.responsibilityMappings.mappings.forEach((mapping, mappingIndex) => {
    pushSymbolEvidenceFromRefs(
      records,
      mapping.constants,
      `responsibilityMappings.mappings[${mappingIndex}].constants`,
      "constant",
      sourceInstance
    );
  });
  artifact.responsibilityMappings.mappings.forEach((mapping, mappingIndex) => {
    pushSymbolEvidenceFromRefs(
      records,
      mapping.errors,
      `responsibilityMappings.mappings[${mappingIndex}].errors`,
      "error",
      sourceInstance
    );
  });
  pushSymbolEvidenceFromRefs(records, artifact.selectedContracts, "selectedContracts", "schema-or-serializer", sourceInstance);
  artifact.responsibilityMappings.mappings.forEach((mapping, mappingIndex) => {
    pushSymbolEvidenceFromRefs(
      records,
      mapping.contracts,
      `responsibilityMappings.mappings[${mappingIndex}].contracts`,
      "schema-or-serializer",
      sourceInstance
    );
  });

  // Section 28: source-range evidence
  artifact.selectedSource.slices.forEach((slice, index) => {
    records.push({
      sourceArtifact: SOURCE_ARTIFACT,
      sourceInstance,
      category: "source-range",
      targetKey: sourceRangeKey(slice.filePath, slice.startLine, slice.endLine),
      sourceFieldPath: `selectedSource.slices[${index}]`
    });
  });
  artifact.selectedSourceBundles.bundles.forEach((bundle, bundleIndex) => {
    bundle.blocks.forEach((block, blockIndex) => {
      records.push({
        sourceArtifact: SOURCE_ARTIFACT,
        sourceInstance,
        category: "source-range",
        targetKey: sourceRangeKey(block.filePath, block.startLine, block.endLine),
        sourceFieldPath: `selectedSourceBundles.bundles[${bundleIndex}].blocks[${blockIndex}]`
      });
    });
  });

  // Section 29: production-responsibility evidence
  artifact.responsibilityMappings.mappings.forEach((mapping, index) => {
    records.push({
      sourceArtifact: SOURCE_ARTIFACT,
      sourceInstance,
      category: "production-responsibility",
      targetKey: responsibilityKey(mapping.responsibilityId),
      sourceFieldPath: `responsibilityMappings.mappings[${index}].responsibilityId`
    });
  });

  // Section 30: package-script and test-command evidence
  artifact.testInfrastructure.packageScripts.forEach((script, index) => {
    records.push({
      sourceArtifact: SOURCE_ARTIFACT,
      sourceInstance,
      category: "package-script",
      targetKey: packageScriptKey(script.name),
      sourceFieldPath: `testInfrastructure.packageScripts[${index}].name`
    });
  });
  artifact.testInfrastructure.testCommands.forEach((command, index) => {
    if (command.commandText !== null) {
      records.push({
        sourceArtifact: SOURCE_ARTIFACT,
        sourceInstance,
        category: "test-command",
        targetKey: testCommandKey(command.commandText),
        sourceFieldPath: `testInfrastructure.testCommands[${index}].commandText`
      });
    }
  });

  // Section 31: context-capsule provenance evidence
  artifact.provenance.forEach((provenanceRecord, index) => {
    records.push({
      sourceArtifact: SOURCE_ARTIFACT,
      sourceInstance,
      category: "provenance",
      targetKey: provenanceKey(provenanceRecord.evidenceId),
      sourceFieldPath: `provenance[${index}].evidenceId`
    });
  });

  return dedupeEvidence(records);
}
