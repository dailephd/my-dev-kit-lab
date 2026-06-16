import path from "node:path";
import { describe, expect, it } from "vitest";
import { readBenchmarkProjectProfiles } from "../../src/evaluation/benchmarkMetadata.js";
import { calculateProjectComplexityScore } from "../../src/evaluation/projectComplexity.js";

describe("benchmark metadata helpers", () => {
  it("reads benchmark project profiles", async () => {
    const profiles = await readBenchmarkProjectProfiles(
      path.join(process.cwd(), "benchmarks", "contracts", "benchmark-project-profiles.json"),
      process.cwd()
    );
    expect(profiles).toHaveLength(6);
    expect(profiles.map((profile) => profile.projectId).sort()).toEqual([
      "task-analytics-large-mixed",
      "task-workflow-medium-ts",
      "todo-js",
      "todo-mixed-ts-py",
      "todo-python",
      "todo-ts"
    ]);
  });

  it("keeps complexity scores stable for current benchmark projects", async () => {
    const profiles = await readBenchmarkProjectProfiles(
      path.join(process.cwd(), "benchmarks", "contracts", "benchmark-project-profiles.json"),
      process.cwd()
    );
    const scores = Object.fromEntries(profiles.map((profile) => [profile.projectId, calculateProjectComplexityScore(profile.complexityMetrics)]));
    expect(scores["todo-js"]).toBe(12);
    expect(scores["todo-python"]).toBe(12);
    expect(scores["todo-ts"]).toBe(12);
    expect(scores["todo-mixed-ts-py"]).toBe(16);
    expect(scores["task-workflow-medium-ts"]).toBeGreaterThan(scores["todo-ts"]);
    expect(scores["task-analytics-large-mixed"]).toBeGreaterThan(scores["task-workflow-medium-ts"]);
  });
});
