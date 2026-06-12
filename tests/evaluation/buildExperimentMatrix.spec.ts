import { describe, expect, it } from "vitest";
import { buildExperimentMatrix } from "../../src/evaluation/index.js";
import { loadExperimentFixtures } from "./experimentTestHelpers.js";

describe("buildExperimentMatrix", () => {
  it("builds raw and my-dev-kit strategy pairs for fake-agent", async () => {
    const { cases } = await loadExperimentFixtures();
    const matrix = buildExperimentMatrix({
      cases: [cases[0]],
      config: { agents: ["fake-agent"], strategies: ["raw-full-file", "my-dev-kit-guided"], complexityLevels: ["short"] }
    });
    expect(matrix.map((cell) => cell.strategy)).toEqual(["raw-full-file", "my-dev-kit-guided"]);
    expect(matrix.every((cell) => cell.agentId === "fake-agent")).toBe(true);
  });

  it("supports selected case IDs, benchmark projects, complexity levels, agents, and maxRuns", async () => {
    const { cases } = await loadExperimentFixtures();
    const matrix = buildExperimentMatrix({
      cases,
      config: {
        caseIds: ["todo-ts-create-task"],
        benchmarkProjects: ["todo-ts"],
        agents: ["fake-agent"],
        strategies: ["raw-full-file", "my-dev-kit-guided"],
        complexityLevels: ["short", "multi-step"],
        maxRuns: 3
      }
    });
    expect(matrix).toHaveLength(3);
    expect(new Set(matrix.map((cell) => cell.caseId))).toEqual(new Set(["todo-ts-create-task"]));
    expect(new Set(matrix.map((cell) => cell.complexityLevel))).toEqual(new Set(["short", "multi-step"]));
  });

  it("rejects invalid strategy and invalid complexity level", async () => {
    const { cases } = await loadExperimentFixtures();
    expect(() =>
      buildExperimentMatrix({ cases, config: { strategies: ["bad" as "raw-full-file"] } })
    ).toThrow("Invalid experiment strategy");
    expect(() => buildExperimentMatrix({ cases, config: { complexityLevels: ["bad" as "short"] } })).toThrow(
      "Invalid prompt complexity level"
    );
  });

  it("does not include real agents by default unless explicitly configured", async () => {
    const { cases } = await loadExperimentFixtures();
    const defaultMatrix = buildExperimentMatrix({ cases: [cases[0]], config: {} });
    expect(defaultMatrix.every((cell) => cell.agentId === "fake-agent")).toBe(true);
    expect(() => buildExperimentMatrix({ cases: [cases[0]], config: { agents: ["codex"] } })).toThrow(
      "requires --include-real-agents"
    );
    expect(
      buildExperimentMatrix({ cases: [cases[0]], config: { agents: ["codex"], includeRealAgents: true, maxRuns: 1 } })[0].agentId
    ).toBe("codex");
  });
});
