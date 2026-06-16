import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { runControlledExperiment } from "../../src/evaluation/index.js";
import { readBenchmarkProjectProfiles, readEvaluationCases } from "../../src/evaluation/index.js";

export async function createFakeExperimentFixture(): Promise<string> {
  const outDir = mkdtempSync(path.join(os.tmpdir(), "experiment-report-fixture-"));
  const projectProfiles = await readBenchmarkProjectProfiles(path.resolve(process.cwd(), "benchmarks/contracts/benchmark-project-profiles.json"));
  const cases = await readEvaluationCases(path.resolve(process.cwd(), "examples/token-savings-cases.json"), process.cwd(), {
    projectProfiles,
    requireProjectProfileRef: true
  });
  await runControlledExperiment({
    config: {
      casesPath: "examples/token-savings-cases.json",
      projectProfilesPath: "benchmarks/contracts/benchmark-project-profiles.json",
      caseIds: ["todo-ts-create-task"],
      agents: ["fake-agent"],
      strategies: ["raw-full-file", "my-dev-kit-guided"],
      complexityLevels: ["short"],
      outDir
    },
    cases,
    projectProfiles
  });
  return outDir;
}
