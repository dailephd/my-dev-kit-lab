import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { validateIncrementalChangeStalenessCatalog } from "../../../src/experiments/plugins/incrementalChangeStaleness/scenarioValidation.js";
import { applyMutationOperations } from "../../../src/experiments/plugins/incrementalChangeStaleness/scenarioMutation.js";
import { INCREMENTAL_CHANGE_STALENESS_SCENARIO_SCHEMA_VERSION } from "../../../src/experiments/plugins/incrementalChangeStaleness/scenarioTypes.js";
import type { BenchmarkProjectProfile, EvaluationCaseInput } from "../../../src/evaluation/types.js";

function sha256(text: string): string {
  return createHash("sha256").update(Buffer.from(text, "utf8")).digest("hex");
}

const FIXTURE_FILE_CONTENT = 'value = "before"\nvalue2 = "before2"\n';
const FIXTURE_FILE_PRE_SHA = sha256(FIXTURE_FILE_CONTENT);

const tempDirs: string[] = [];
afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

/** Builds a minimal disposable fixture repo with one project containing one mutable file. */
function makeFixtureRepo(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "ics-scenario-"));
  tempDirs.push(dir);
  const projectDir = path.join(dir, "proj");
  mkdirSync(path.join(projectDir, "src"), { recursive: true });
  writeFileSync(path.join(projectDir, "src", "file.py"), FIXTURE_FILE_CONTENT, "utf8");
  return dir;
}

function makeFixtureProfiles(): BenchmarkProjectProfile[] {
  return [
    {
      projectId: "proj",
      rootPath: "proj"
    } as unknown as BenchmarkProjectProfile
  ];
}

function makeFixtureCases(overrides: Partial<EvaluationCaseInput> = {}): EvaluationCaseInput[] {
  return [
    {
      id: "base-case",
      title: "Base case",
      benchmarkProject: "proj",
      targetRoot: "proj",
      sourceRoots: ["src"],
      query: "base query",
      expectedFiles: ["src/file.py"],
      expectedSymbols: ["value"],
      rawIncludeGlobs: ["src/**/*"],
      answerKey: {
        expectedFiles: ["src/file.py"],
        expectedSymbols: ["value"],
        expectedFacts: [{ id: "fact-1", text: "value is before.", weight: 1, required: true }],
        minimumCorrectFacts: 1
      },
      ...overrides
    }
  ];
}

function makeValidScenario(overrides: Record<string, unknown> = {}) {
  return {
    id: "S1",
    category: "local-implementation-change",
    benchmarkProjectId: "proj",
    baseCaseId: "base-case",
    answerPolicy: "scenario",
    scenarioQuery: "what is value now?",
    scenarioAnswerKey: {
      expectedFiles: ["src/file.py"],
      expectedSymbols: ["value"],
      expectedFacts: [{ id: "fact-1", text: "value is after.", weight: 1, required: true }],
      minimumCorrectFacts: 1
    },
    mutation: {
      files: [
        {
          path: "src/file.py",
          expectedPreSha256: FIXTURE_FILE_PRE_SHA,
          operations: [{ expectedPreimage: '"before"', replacement: '"after"' }],
          expectedPostSha256: sha256('value = "after"\nvalue2 = "before2"\n')
        }
      ]
    },
    ...overrides
  };
}

describe("validateIncrementalChangeStalenessCatalog", () => {
  it("accepts a valid single-scenario catalog and leaves the fixture file unchanged", async () => {
    const repoRoot = makeFixtureRepo();
    const errors = await validateIncrementalChangeStalenessCatalog(
      { schemaVersion: INCREMENTAL_CHANGE_STALENESS_SCENARIO_SCHEMA_VERSION, scenarios: [makeValidScenario()] },
      makeFixtureProfiles(),
      makeFixtureCases(),
      repoRoot
    );
    expect(errors).toEqual([]);
  });

  it("is deterministic across repeated validation runs", async () => {
    const repoRoot = makeFixtureRepo();
    const catalog = { schemaVersion: INCREMENTAL_CHANGE_STALENESS_SCENARIO_SCHEMA_VERSION, scenarios: [makeValidScenario()] };
    const first = await validateIncrementalChangeStalenessCatalog(catalog, makeFixtureProfiles(), makeFixtureCases(), repoRoot);
    const second = await validateIncrementalChangeStalenessCatalog(catalog, makeFixtureProfiles(), makeFixtureCases(), repoRoot);
    expect(second).toEqual(first);
    expect(second).toEqual([]);
  });

  const negativeCases: Array<{ name: string; build: () => { catalog: unknown; profiles: BenchmarkProjectProfile[]; cases: EvaluationCaseInput[] } }> = [
    {
      name: "unsupported schema version fails",
      build: () => ({ catalog: { schemaVersion: "9.9.9", scenarios: [makeValidScenario()] }, profiles: makeFixtureProfiles(), cases: makeFixtureCases() })
    },
    {
      name: "duplicate scenario ids fail",
      build: () => ({
        catalog: { schemaVersion: INCREMENTAL_CHANGE_STALENESS_SCENARIO_SCHEMA_VERSION, scenarios: [makeValidScenario(), makeValidScenario()] },
        profiles: makeFixtureProfiles(),
        cases: makeFixtureCases()
      })
    },
    {
      name: "unsupported category fails",
      build: () => ({
        catalog: { schemaVersion: INCREMENTAL_CHANGE_STALENESS_SCENARIO_SCHEMA_VERSION, scenarios: [makeValidScenario({ category: "not-a-real-category" })] },
        profiles: makeFixtureProfiles(),
        cases: makeFixtureCases()
      })
    },
    {
      name: "unsupported answer policy fails",
      build: () => ({
        catalog: { schemaVersion: INCREMENTAL_CHANGE_STALENESS_SCENARIO_SCHEMA_VERSION, scenarios: [makeValidScenario({ answerPolicy: "guess" })] },
        profiles: makeFixtureProfiles(),
        cases: makeFixtureCases()
      })
    },
    {
      name: "unknown benchmark project fails",
      build: () => ({
        catalog: { schemaVersion: INCREMENTAL_CHANGE_STALENESS_SCENARIO_SCHEMA_VERSION, scenarios: [makeValidScenario({ benchmarkProjectId: "does-not-exist" })] },
        profiles: makeFixtureProfiles(),
        cases: makeFixtureCases()
      })
    },
    {
      name: "unknown base case fails",
      build: () => ({
        catalog: { schemaVersion: INCREMENTAL_CHANGE_STALENESS_SCENARIO_SCHEMA_VERSION, scenarios: [makeValidScenario({ baseCaseId: "does-not-exist" })] },
        profiles: makeFixtureProfiles(),
        cases: makeFixtureCases()
      })
    },
    {
      name: "case/project mismatch fails",
      build: () => ({
        catalog: { schemaVersion: INCREMENTAL_CHANGE_STALENESS_SCENARIO_SCHEMA_VERSION, scenarios: [makeValidScenario({ benchmarkProjectId: "other-proj" })] },
        profiles: [...makeFixtureProfiles(), { projectId: "other-proj", rootPath: "proj" } as unknown as BenchmarkProjectProfile],
        cases: makeFixtureCases()
      })
    },
    {
      name: "mutation path escaping the benchmark project fails",
      build: () => ({
        catalog: {
          schemaVersion: INCREMENTAL_CHANGE_STALENESS_SCENARIO_SCHEMA_VERSION,
          scenarios: [
            makeValidScenario({
              mutation: { files: [{ path: "../outside.py", expectedPreSha256: FIXTURE_FILE_PRE_SHA, operations: [{ expectedPreimage: "x", replacement: "y" }], expectedPostSha256: FIXTURE_FILE_PRE_SHA }] }
            })
          ]
        },
        profiles: makeFixtureProfiles(),
        cases: makeFixtureCases()
      })
    },
    {
      name: "mutation path outside the case's indexed source roots fails",
      build: () => ({
        catalog: {
          schemaVersion: INCREMENTAL_CHANGE_STALENESS_SCENARIO_SCHEMA_VERSION,
          scenarios: [
            makeValidScenario({
              mutation: {
                files: [
                  {
                    path: "docs/file.py",
                    expectedPreSha256: FIXTURE_FILE_PRE_SHA,
                    operations: [{ expectedPreimage: "x", replacement: "y" }],
                    expectedPostSha256: FIXTURE_FILE_PRE_SHA
                  }
                ]
              }
            })
          ]
        },
        profiles: makeFixtureProfiles(),
        cases: makeFixtureCases()
      })
    },
    {
      name: "wrong expectedPreSha256 fails",
      build: () => ({
        catalog: {
          schemaVersion: INCREMENTAL_CHANGE_STALENESS_SCENARIO_SCHEMA_VERSION,
          scenarios: [
            makeValidScenario({
              mutation: {
                files: [
                  {
                    path: "src/file.py",
                    expectedPreSha256: "0".repeat(64),
                    operations: [{ expectedPreimage: '"before"', replacement: '"after"' }],
                    expectedPostSha256: sha256('value = "after"\nvalue2 = "before2"\n')
                  }
                ]
              }
            })
          ]
        },
        profiles: makeFixtureProfiles(),
        cases: makeFixtureCases()
      })
    },
    {
      name: "missing expected preimage fails",
      build: () => ({
        catalog: {
          schemaVersion: INCREMENTAL_CHANGE_STALENESS_SCENARIO_SCHEMA_VERSION,
          scenarios: [
            makeValidScenario({
              mutation: {
                files: [
                  {
                    path: "src/file.py",
                    expectedPreSha256: FIXTURE_FILE_PRE_SHA,
                    operations: [{ expectedPreimage: "not-present-anywhere", replacement: "x" }],
                    expectedPostSha256: FIXTURE_FILE_PRE_SHA
                  }
                ]
              }
            })
          ]
        },
        profiles: makeFixtureProfiles(),
        cases: makeFixtureCases()
      })
    },
    {
      name: "ambiguous (multiple-match) preimage fails",
      build: () => ({
        catalog: {
          schemaVersion: INCREMENTAL_CHANGE_STALENESS_SCENARIO_SCHEMA_VERSION,
          scenarios: [
            makeValidScenario({
              mutation: {
                files: [
                  {
                    path: "src/file.py",
                    expectedPreSha256: FIXTURE_FILE_PRE_SHA,
                    operations: [{ expectedPreimage: "before", replacement: "after" }],
                    expectedPostSha256: FIXTURE_FILE_PRE_SHA
                  }
                ]
              }
            })
          ]
        },
        profiles: makeFixtureProfiles(),
        cases: makeFixtureCases()
      })
    },
    {
      name: "wrong expectedPostSha256 fails",
      build: () => ({
        catalog: {
          schemaVersion: INCREMENTAL_CHANGE_STALENESS_SCENARIO_SCHEMA_VERSION,
          scenarios: [
            makeValidScenario({
              mutation: {
                files: [
                  {
                    path: "src/file.py",
                    expectedPreSha256: FIXTURE_FILE_PRE_SHA,
                    operations: [{ expectedPreimage: '"before"', replacement: '"after"' }],
                    expectedPostSha256: "1".repeat(64)
                  }
                ]
              }
            })
          ]
        },
        profiles: makeFixtureProfiles(),
        cases: makeFixtureCases()
      })
    },
    {
      name: "scenario policy without scenarioQuery fails",
      build: () => ({
        catalog: { schemaVersion: INCREMENTAL_CHANGE_STALENESS_SCENARIO_SCHEMA_VERSION, scenarios: [makeValidScenario({ scenarioQuery: undefined })] },
        profiles: makeFixtureProfiles(),
        cases: makeFixtureCases()
      })
    },
    {
      name: "scenario policy without scenarioAnswerKey fails",
      build: () => ({
        catalog: { schemaVersion: INCREMENTAL_CHANGE_STALENESS_SCENARIO_SCHEMA_VERSION, scenarios: [makeValidScenario({ scenarioAnswerKey: undefined })] },
        profiles: makeFixtureProfiles(),
        cases: makeFixtureCases()
      })
    },
    {
      name: "inherit policy fails when the base case has no answerKey",
      build: () => ({
        catalog: {
          schemaVersion: INCREMENTAL_CHANGE_STALENESS_SCENARIO_SCHEMA_VERSION,
          scenarios: [makeValidScenario({ answerPolicy: "inherit", scenarioQuery: undefined, scenarioAnswerKey: undefined })]
        },
        profiles: makeFixtureProfiles(),
        cases: makeFixtureCases({ answerKey: undefined })
      })
    },
    {
      name: "forbidden partial-refresh vocabulary in scenario text fails",
      build: () => ({
        catalog: { schemaVersion: INCREMENTAL_CHANGE_STALENESS_SCENARIO_SCHEMA_VERSION, scenarios: [makeValidScenario({ notes: "uses partial-refresh here" })] },
        profiles: makeFixtureProfiles(),
        cases: makeFixtureCases()
      })
    },
    {
      name: "forbidden graph-diff vocabulary in scenario text fails",
      build: () => ({
        catalog: { schemaVersion: INCREMENTAL_CHANGE_STALENESS_SCENARIO_SCHEMA_VERSION, scenarios: [makeValidScenario({ notes: "depends on graph-diff output" })] },
        profiles: makeFixtureProfiles(),
        cases: makeFixtureCases()
      })
    }
  ];

  for (const { name, build } of negativeCases) {
    it(name, async () => {
      const repoRoot = makeFixtureRepo();
      const { catalog, profiles, cases } = build();
      const errors = await validateIncrementalChangeStalenessCatalog(catalog, profiles, cases, repoRoot);
      expect(errors.length).toBeGreaterThan(0);
    });
  }

  it("requiring frozen production scenarios rejects a catalog missing some of the six ids", async () => {
    const repoRoot = makeFixtureRepo();
    const errors = await validateIncrementalChangeStalenessCatalog(
      { schemaVersion: INCREMENTAL_CHANGE_STALENESS_SCENARIO_SCHEMA_VERSION, scenarios: [makeValidScenario({ id: "U1", category: "unrelated-file-change" })] },
      makeFixtureProfiles(),
      makeFixtureCases(),
      repoRoot,
      { requireFrozenProductionScenarios: true }
    );
    expect(errors.some((message) => message.includes("missing required frozen scenario"))).toBe(true);
  });
});

describe("applyMutationOperations", () => {
  it("applies ordered replacements in sequence", () => {
    const result = applyMutationOperations("a=1;b=2;", [
      { expectedPreimage: "a=1", replacement: "a=10" },
      { expectedPreimage: "b=2", replacement: "b=20" }
    ]);
    expect(result).toBe("a=10;b=20;");
  });

  it("throws when a preimage is missing", () => {
    expect(() => applyMutationOperations("a=1;", [{ expectedPreimage: "a=999", replacement: "a=10" }])).toThrow(/not found/);
  });

  it("throws when a preimage matches more than once", () => {
    expect(() => applyMutationOperations("a=1;a=1;", [{ expectedPreimage: "a=1", replacement: "a=2" }])).toThrow(/matches 2 times/);
  });
});
