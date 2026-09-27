import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { readBenchmarkProjectProfiles } from "../../../src/evaluation/benchmarkMetadata.js";
import { readEvaluationCases } from "../../../src/evaluation/readEvaluationCases.js";
import {
  BENCHMARK_PROJECT_PROFILES_PATH,
  INCREMENTAL_CHANGE_STALENESS_SCENARIO_CATALOG_PATH,
  WARM_INDEX_BENCHMARK_CASES_PATH,
  readProductionIncrementalChangeStalenessScenarioCatalog
} from "../../../src/experiments/plugins/incrementalChangeStaleness/scenarioCatalog.js";
import { validateMutationFile } from "../../../src/experiments/plugins/incrementalChangeStaleness/scenarioMutation.js";
import { FROZEN_SCENARIO_CATEGORY_BY_ID } from "../../../src/experiments/plugins/incrementalChangeStaleness/scenarioValidation.js";
import { FROZEN_INCREMENTAL_CHANGE_STALENESS_SCENARIO_IDS, INCREMENTAL_CHANGE_STALENESS_SCENARIO_SCHEMA_VERSION } from "../../../src/experiments/plugins/incrementalChangeStaleness/scenarioTypes.js";

const repoRoot = process.cwd();

function sha256OfFile(relativePath: string): string {
  const buffer = readFileSync(path.resolve(repoRoot, relativePath));
  return createHash("sha256").update(buffer).digest("hex");
}

describe("production incremental-change-staleness scenario catalog", () => {
  it("loads and validates all six frozen scenario records (TST-B1-001)", async () => {
    const catalog = await readProductionIncrementalChangeStalenessScenarioCatalog(repoRoot);
    expect(catalog.schemaVersion).toBe(INCREMENTAL_CHANGE_STALENESS_SCENARIO_SCHEMA_VERSION);
    expect(catalog.scenarios).toHaveLength(6);
  });

  it("has unique scenario ids (TST-B1-002)", async () => {
    const catalog = await readProductionIncrementalChangeStalenessScenarioCatalog(repoRoot);
    const ids = catalog.scenarios.map((scenario) => scenario.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("contains exactly the six frozen scenario ids and their frozen categories (TST-B1-019..024 identity)", async () => {
    const catalog = await readProductionIncrementalChangeStalenessScenarioCatalog(repoRoot);
    const byId = new Map(catalog.scenarios.map((scenario) => [scenario.id, scenario]));
    expect([...byId.keys()].sort()).toEqual([...FROZEN_INCREMENTAL_CHANGE_STALENESS_SCENARIO_IDS].sort());
    for (const id of FROZEN_INCREMENTAL_CHANGE_STALENESS_SCENARIO_IDS) {
      expect(byId.get(id)?.category).toBe(FROZEN_SCENARIO_CATEGORY_BY_ID[id]);
    }
  });

  it("U1 encodes the frozen 80 -> 81 Python quality mutation and inherits the TS leaderboard answer (TST-B1-019)", async () => {
    const catalog = await readProductionIncrementalChangeStalenessScenarioCatalog(repoRoot);
    const u1 = catalog.scenarios.find((scenario) => scenario.id === "U1")!;
    expect(u1.answerPolicy).toBe("inherit");
    expect(u1.baseCaseId).toBe("warm-large-ts-leaderboard");
    expect(u1.mutation.files).toHaveLength(1);
    expect(u1.mutation.files[0].path).toBe("py/task_analytics/quality.py");
    expect(u1.mutation.files[0].operations).toHaveLength(1);
    expect(u1.mutation.files[0].operations[0].expectedPreimage).toContain(">= 80");
    expect(u1.mutation.files[0].operations[0].replacement).toContain(">= 81");
  });

  it("L2 encodes the frozen completion timestamp replacement (TST-B1-020)", async () => {
    const catalog = await readProductionIncrementalChangeStalenessScenarioCatalog(repoRoot);
    const l2 = catalog.scenarios.find((scenario) => scenario.id === "L2")!;
    expect(l2.mutation.files[0].path).toBe("src/services/completeTask.ts");
    expect(l2.mutation.files[0].operations[0].expectedPreimage).toBe('"2026-02-01T00:00:00.000Z"');
    expect(l2.mutation.files[0].operations[0].replacement).toBe('"2026-03-01T00:00:00.000Z"');
    expect(l2.scenarioAnswerKey?.expectedFacts.some((fact) => fact.text.includes("2026-03-01T00:00:00.000Z"))).toBe(true);
  });

  it("E1 encodes the frozen 80 -> 85 exported quality threshold (TST-B1-021)", async () => {
    const catalog = await readProductionIncrementalChangeStalenessScenarioCatalog(repoRoot);
    const e1 = catalog.scenarios.find((scenario) => scenario.id === "E1")!;
    expect(e1.mutation.files[0].path).toBe("py/task_analytics/quality.py");
    expect(e1.mutation.files[0].operations[0].replacement).toContain(">= 85");
  });

  it("P1 encodes the frozen optional stale_day_threshold API change through ordered exact replacements (TST-B1-022)", async () => {
    const catalog = await readProductionIncrementalChangeStalenessScenarioCatalog(repoRoot);
    const p1 = catalog.scenarios.find((scenario) => scenario.id === "P1")!;
    expect(p1.mutation.files[0].path).toBe("py/task_analytics/metrics.py");
    expect(p1.mutation.files[0].operations).toHaveLength(2);
    expect(p1.mutation.files[0].operations[0].replacement).toContain("stale_day_threshold=STALE_DAY_THRESHOLD");
    expect(p1.mutation.files[0].operations[1].replacement).toContain(">= stale_day_threshold");
  });

  it("I1 encodes the frozen buildAnalyticsSnapshot dependency removal through ordered exact replacements (TST-B1-023)", async () => {
    const catalog = await readProductionIncrementalChangeStalenessScenarioCatalog(repoRoot);
    const i1 = catalog.scenarios.find((scenario) => scenario.id === "I1")!;
    expect(i1.mutation.files[0].path).toBe("ts/src/services/buildAnalyticsSnapshot.ts");
    expect(i1.mutation.files[0].operations).toHaveLength(2);
    expect(i1.mutation.files[0].operations[0].expectedPreimage).toContain("listTasksByProject");
    expect(i1.mutation.files[0].operations[0].replacement).toBe("");
    expect(i1.mutation.files[0].operations[1].replacement).toContain("taskStore.list().filter(");
  });

  it("T1 records the corrected task-1 updated_day 8 -> 9 mutation while leaving production expectations unchanged (TST-B1-024, blocker regression)", async () => {
    const catalog = await readProductionIncrementalChangeStalenessScenarioCatalog(repoRoot);
    const t1 = catalog.scenarios.find((scenario) => scenario.id === "T1")!;
    expect(t1.category).toBe("test-only-change");
    expect(t1.answerPolicy).toBe("scenario");
    expect(t1.mutation.files).toHaveLength(1);
    expect(t1.mutation.files[0].path).toBe("py/tests/test_quality.py");
    expect(t1.mutation.files[0].operations).toHaveLength(1);
    const op = t1.mutation.files[0].operations[0];
    expect(op.expectedPreimage).toContain('"task_id": "task-1"');
    expect(op.expectedPreimage).toContain('"updated_day": 8');
    expect(op.replacement).toContain('"updated_day": 9');
    // Exactly one bounded literal changed: task-1's updated_day, nothing else in the row.
    expect(op.expectedPreimage.replace("8", "9")).toBe(op.replacement);
    expect(t1.scenarioAnswerKey?.expectedFacts.some((fact) => fact.text.includes("100.0"))).toBe(true);
    expect(t1.scenarioAnswerKey?.expectedFacts.some((fact) => fact.text.toLowerCase().includes("healthy"))).toBe(true);
  });

  it("in-memory-validates T1's mutation against the real canonical file and proves it stays on disk unchanged (blocker regression, TST-B1-016)", async () => {
    const before = readFileSync(path.resolve(repoRoot, "benchmarks/projects/task-analytics-large-mixed/py/tests/test_quality.py"));
    const catalog = await readProductionIncrementalChangeStalenessScenarioCatalog(repoRoot);
    const t1 = catalog.scenarios.find((scenario) => scenario.id === "T1")!;
    const projectAbsoluteRoot = path.resolve(repoRoot, "benchmarks/projects/task-analytics-large-mixed");
    const result = await validateMutationFile("T1.mutation.files[0]", t1.mutation.files[0], projectAbsoluteRoot, ["ts/src", "ts/tests", "py/task_analytics", "py/tests"]);
    expect(result.errors).toEqual([]);
    expect(result.mutatedText).toBeDefined();
    expect(result.mutatedText).toContain('"updated_day": 9');
    expect(result.mutatedText).not.toContain('"task_id": "task-1", "project_id": "alpha", "completed": True, "story_points": 5, "updated_day": 8');
    const after = readFileSync(path.resolve(repoRoot, "benchmarks/projects/task-analytics-large-mixed/py/tests/test_quality.py"));
    expect(Buffer.compare(before, after)).toBe(0);
  });

  it("never reintroduces the abandoned completion_rate X -> X+1 T1 design (corrected-baseline regression)", async () => {
    const catalog = await readProductionIncrementalChangeStalenessScenarioCatalog(repoRoot);
    const t1 = catalog.scenarios.find((scenario) => scenario.id === "T1")!;
    for (const file of t1.mutation.files) {
      for (const operation of file.operations) {
        expect(operation.expectedPreimage).not.toContain("completion_rate");
        expect(operation.replacement).not.toContain("completion_rate");
        expect(operation.expectedPreimage).not.toMatch(/>=\s*8[0-9]\b/);
      }
    }
  });

  it("keeps the existing warm-index benchmark catalog byte-for-byte unchanged (TST-B1-025)", () => {
    const sha = sha256OfFile(WARM_INDEX_BENCHMARK_CASES_PATH);
    // Recorded before this batch's implementation began; see FINAL REPORT item 24.
    expect(sha).toBe("f3fc9a6cac68c4d14d27eb5cc7d83944b6064a9edde6206357b2f6c2ceaef4c7");
  });

  it("keeps every selected canonical benchmark source/test file byte-for-byte unchanged (TST-B1-016, TST-B1-030)", async () => {
    const expected: Record<string, string> = {
      "benchmarks/projects/task-analytics-large-mixed/py/task_analytics/quality.py": "5faab1bf018de6e647a11a2edffd641a51c0c05b399cb6f58a2c22b0ff035554",
      "benchmarks/projects/task-analytics-large-mixed/py/task_analytics/metrics.py": "da2bfce46ec51016f87b3456a201e69a9d71721002e1781b44fdc59a96650e91",
      "benchmarks/projects/task-analytics-large-mixed/ts/src/services/buildAnalyticsSnapshot.ts": "928af15041715ffa19ae3674e8d4f82e1c5f694cfa2bad1fea03db31bce6cedd",
      "benchmarks/projects/task-analytics-large-mixed/py/tests/test_quality.py": "b5610a2720012532baf6d18e114f375424008e0daadbc27291bfca2ce6316875",
      "benchmarks/projects/task-workflow-medium-ts/src/services/completeTask.ts": "27f6833abb1c5f8fa7226ec8a4857ba267dd48272d7cf094c7a3462e425ca64c"
    };
    for (const [relativePath, expectedSha] of Object.entries(expected)) {
      expect(sha256OfFile(relativePath)).toBe(expectedSha);
    }

    // Validate the full production catalog twice (mutation validation is in-memory only)
    // and re-check the same files afterward: repeated validation must never mutate them.
    await readProductionIncrementalChangeStalenessScenarioCatalog(repoRoot);
    await readProductionIncrementalChangeStalenessScenarioCatalog(repoRoot);
    for (const [relativePath, expectedSha] of Object.entries(expected)) {
      expect(sha256OfFile(relativePath)).toBe(expectedSha);
    }
  });

  it("declares no partial-refresh or graph-diff vocabulary anywhere in the catalog (TST-B1-027, TST-B1-028)", async () => {
    const catalog = await readProductionIncrementalChangeStalenessScenarioCatalog(repoRoot);
    const serialized = JSON.stringify(catalog).toLowerCase();
    expect(serialized).not.toContain("partial-refresh");
    expect(serialized).not.toContain("changed-files-refresh");
    expect(serialized).not.toContain("affected-neighborhood-refresh");
    expect(serialized).not.toContain("graph-diff");
  });

  it("carries no executable mutation instructions (TST-B1-029)", async () => {
    const catalog = await readProductionIncrementalChangeStalenessScenarioCatalog(repoRoot);
    for (const scenario of catalog.scenarios) {
      for (const file of scenario.mutation.files) {
        for (const operation of file.operations) {
          expect(typeof operation.expectedPreimage).toBe("string");
          expect(typeof operation.replacement).toBe("string");
        }
      }
    }
  });

  it("every mutation path is represented by the referenced case's indexed roots (TST-B1-026)", async () => {
    const profiles = await readBenchmarkProjectProfiles(path.resolve(repoRoot, BENCHMARK_PROJECT_PROFILES_PATH), repoRoot);
    const cases = await readEvaluationCases(path.resolve(repoRoot, WARM_INDEX_BENCHMARK_CASES_PATH), repoRoot);
    const casesById = new Map(cases.map((benchmarkCase) => [benchmarkCase.id, benchmarkCase]));
    const catalog = await readProductionIncrementalChangeStalenessScenarioCatalog(repoRoot);
    for (const scenario of catalog.scenarios) {
      const baseCase = casesById.get(scenario.baseCaseId)!;
      for (const file of scenario.mutation.files) {
        const covered = baseCase.sourceRoots.some((root) => file.path === root || file.path.startsWith(`${root}/`));
        expect(covered).toBe(true);
      }
    }
    // profiles fixture usage keeps this test symmetric with the loader's own dependency wiring.
    expect(profiles.length).toBeGreaterThan(0);
  });

  it("resolves the expected canonical catalog path (TST informational)", () => {
    expect(INCREMENTAL_CHANGE_STALENESS_SCENARIO_CATALOG_PATH).toBe("benchmarks/contracts/incremental-change-staleness-scenarios.json");
  });
});
