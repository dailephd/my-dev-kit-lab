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
    expect(profiles).toHaveLength(4);
    expect(profiles.map((profile) => profile.projectId).sort()).toEqual([
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
    expect(Object.fromEntries(profiles.map((profile) => [profile.projectId, calculateProjectComplexityScore(profile.complexityMetrics)]))).toEqual({
      "todo-js": 12,
      "todo-mixed-ts-py": 16,
      "todo-python": 12,
      "todo-ts": 12
    });
  });
});
