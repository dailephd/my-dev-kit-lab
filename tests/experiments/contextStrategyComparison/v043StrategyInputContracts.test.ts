import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { ContextRole } from "../../../src/evaluation/upstreamArtifacts/index.js";
import type {
  ArchitectureContextOnlyStrategyInputV1,
  ArchitecturePlusImplementationAndTestRefreshStrategyInputV1,
  ArchitecturePlusImplementationRefreshStrategyInputV1,
  BoundedWorkflowInstructionPacketStrategyInputV1,
  CombinedBoundedStageContextArtifactInputV1,
  CombinedBoundedStageContextStrategyInputV1,
  FullWorkflowLibraryStrategyInputV1,
  V043StageContextStrategyInputV1
} from "../../../src/experiments/plugins/contextStrategyComparison/v043StrategyInputContracts.js";

const CONTRACTS_FILE = "src/experiments/plugins/contextStrategyComparison/v043StrategyInputContracts.ts";

const architectureContextOnly: ArchitectureContextOnlyStrategyInputV1 = {
  strategyId: "architecture-context-only",
  expectationsPath: "tests/fixtures/stage-context-expectations/complete-v1.0.0.json",
  architectureContextCapsulePath: "fixtures/architecture-context-capsule.json"
};

const architecturePlusImplementationRefresh: ArchitecturePlusImplementationRefreshStrategyInputV1 = {
  strategyId: "architecture-plus-implementation-refresh",
  expectationsPath: "tests/fixtures/stage-context-expectations/complete-v1.0.0.json",
  architectureContextCapsulePath: "fixtures/architecture-context-capsule.json",
  implementationContextCapsulePath: "fixtures/implementation-context-capsule.json"
};

const architecturePlusImplementationAndTestRefresh: ArchitecturePlusImplementationAndTestRefreshStrategyInputV1 = {
  strategyId: "architecture-plus-implementation-and-test-refresh",
  expectationsPath: "tests/fixtures/stage-context-expectations/complete-v1.0.0.json",
  architectureContextCapsulePath: "fixtures/architecture-context-capsule.json",
  implementationContextCapsulePath: "fixtures/implementation-context-capsule.json",
  testImplementationContextCapsulePath: "fixtures/test-implementation-context-capsule.json"
};

const fullWorkflowLibrary: FullWorkflowLibraryStrategyInputV1 = {
  strategyId: "full-workflow-library",
  expectationsPath: "tests/fixtures/stage-context-expectations/complete-v1.0.0.json",
  fullWorkflowLibraryFixturePath: "fixtures/full-workflow-library.json"
};

const boundedWorkflowInstructionPacket: BoundedWorkflowInstructionPacketStrategyInputV1 = {
  strategyId: "bounded-workflow-instruction-packet",
  expectationsPath: "tests/fixtures/stage-context-expectations/complete-v1.0.0.json",
  workflowInstructionPacketPath: "fixtures/workflow-instruction-packet.json"
};

const combinedEntry: CombinedBoundedStageContextArtifactInputV1 = {
  role: "architecture",
  contextCapsulePath: "fixtures/architecture-context-capsule.json"
};

const combinedBoundedStageContext: CombinedBoundedStageContextStrategyInputV1 = {
  strategyId: "combined-bounded-stage-context",
  expectationsPath: "tests/fixtures/stage-context-expectations/complete-v1.0.0.json",
  contextArtifacts: [combinedEntry],
  workflowInstructionPacketPath: "fixtures/workflow-instruction-packet.json"
};

function keysOf(value: object): string[] {
  return Object.keys(value).sort();
}

function discriminate(input: V043StageContextStrategyInputV1): string {
  switch (input.strategyId) {
    case "architecture-context-only":
      return input.architectureContextCapsulePath;
    case "architecture-plus-implementation-refresh":
      return input.implementationContextCapsulePath;
    case "architecture-plus-implementation-and-test-refresh":
      return input.testImplementationContextCapsulePath;
    case "full-workflow-library":
      return input.fullWorkflowLibraryFixturePath;
    case "bounded-workflow-instruction-packet":
      return input.workflowInstructionPacketPath;
    case "combined-bounded-stage-context":
      return input.workflowInstructionPacketPath;
  }
}

describe("v0.4.3 strategy input contracts", () => {
  it("STR-007 architecture-context-only contract has exact keys", () => {
    expect(keysOf(architectureContextOnly)).toEqual(
      ["strategyId", "expectationsPath", "architectureContextCapsulePath"].sort()
    );
  });

  it("STR-008 architecture-plus-implementation contract has exact keys", () => {
    expect(keysOf(architecturePlusImplementationRefresh)).toEqual(
      ["strategyId", "expectationsPath", "architectureContextCapsulePath", "implementationContextCapsulePath"].sort()
    );
  });

  it("STR-009 architecture-plus-implementation-and-test contract has exact keys", () => {
    expect(keysOf(architecturePlusImplementationAndTestRefresh)).toEqual(
      [
        "strategyId",
        "expectationsPath",
        "architectureContextCapsulePath",
        "implementationContextCapsulePath",
        "testImplementationContextCapsulePath"
      ].sort()
    );
  });

  it("STR-010 full-workflow-library contract has exact keys", () => {
    expect(keysOf(fullWorkflowLibrary)).toEqual(["strategyId", "expectationsPath", "fullWorkflowLibraryFixturePath"].sort());
  });

  it("STR-011 bounded-packet contract has exact keys", () => {
    expect(keysOf(boundedWorkflowInstructionPacket)).toEqual(
      ["strategyId", "expectationsPath", "workflowInstructionPacketPath"].sort()
    );
  });

  it("STR-012 combined contract has exact keys", () => {
    expect(keysOf(combinedBoundedStageContext)).toEqual(
      ["strategyId", "expectationsPath", "contextArtifacts", "workflowInstructionPacketPath"].sort()
    );
  });

  it("STR-013 combined context entry has exact keys", () => {
    expect(keysOf(combinedEntry)).toEqual(["role", "contextCapsulePath"].sort());
  });

  it("STR-014 ContextRole is reused from Batch 1", () => {
    const role: ContextRole = combinedEntry.role;
    expect(["architecture", "implementation", "test-implementation"]).toContain(role);
  });

  it("STR-015 the six-contract union discriminates by strategyId", () => {
    expect(discriminate(architectureContextOnly)).toBe(architectureContextOnly.architectureContextCapsulePath);
    expect(discriminate(architecturePlusImplementationRefresh)).toBe(
      architecturePlusImplementationRefresh.implementationContextCapsulePath
    );
    expect(discriminate(architecturePlusImplementationAndTestRefresh)).toBe(
      architecturePlusImplementationAndTestRefresh.testImplementationContextCapsulePath
    );
    expect(discriminate(fullWorkflowLibrary)).toBe(fullWorkflowLibrary.fullWorkflowLibraryFixturePath);
    expect(discriminate(boundedWorkflowInstructionPacket)).toBe(
      boundedWorkflowInstructionPacket.workflowInstructionPacketPath
    );
    expect(discriminate(combinedBoundedStageContext)).toBe(combinedBoundedStageContext.workflowInstructionPacketPath);
  });

  it("STR-016 no raw-full-file input contract is added", () => {
    const source = readFileSync(CONTRACTS_FILE, "utf8");
    expect(source).not.toContain('"raw-full-file"');
  });

  it("STR-017 no my-dev-kit-guided input contract is added", () => {
    const source = readFileSync(CONTRACTS_FILE, "utf8");
    expect(source).not.toContain('"my-dev-kit-guided"');
  });

  it("STR-018 no contract contains a directory-scan field", () => {
    const source = readFileSync(CONTRACTS_FILE, "utf8");
    expect(source.toLowerCase()).not.toContain("directorypath");
    expect(source.toLowerCase()).not.toContain("scandirectory");
  });

  it("STR-019 no contract contains a glob field", () => {
    const source = readFileSync(CONTRACTS_FILE, "utf8");
    expect(source.toLowerCase()).not.toContain("glob");
  });

  it("STR-020 no contract contains an artifact auto-detection field", () => {
    const source = readFileSync(CONTRACTS_FILE, "utf8");
    expect(source.toLowerCase()).not.toContain("autodetect");
    expect(source.toLowerCase()).not.toContain("latestartifact");
    expect(source.toLowerCase()).not.toContain("artifactkind");
  });
});
