import { existsSync, mkdtempSync } from "node:fs";
import { readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runControlledExperiment } from "../../src/evaluation/index.js";
import { loadExperimentFixtures } from "./experimentTestHelpers.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("runControlledExperiment", () => {
  it("runs fake-agent over both strategies and writes expected artifacts only", async () => {
    const outDir = mkdtempSync(path.join(os.tmpdir(), "controlled-experiment-"));
    tempDirs.push(outDir);
    const { cases, projectProfiles } = await loadExperimentFixtures();
    const artifacts = await runControlledExperiment({
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
    expect(artifacts.runs).toHaveLength(2);
    expect(artifacts.comparisons).toHaveLength(1);
    expect(existsSync(path.join(outDir, "experiment-summary.json"))).toBe(true);
    expect(existsSync(path.join(outDir, "experiment-runs.json"))).toBe(true);
    expect(existsSync(path.join(outDir, "experiment-comparisons.json"))).toBe(true);
    expect(existsSync(path.join(outDir, "runs", artifacts.runs[0].runId, "prompt.txt"))).toBe(true);
    expect(existsSync(path.join(outDir, "runs", artifacts.runs[0].runId, "correctness-score.json"))).toBe(true);
    expect(existsSync(path.join(outDir, "token-savings-report.html"))).toBe(false);
    expect(existsSync(path.join(outDir, "token-savings-report.png"))).toBe(false);
    expect(existsSync(path.join(outDir, "gallery-manifest.json"))).toBe(false);
  });

  it("continues after fake failure when requested and stops when continueOnFailure is false", async () => {
    const { cases, projectProfiles } = await loadExperimentFixtures();
    const continueDir = mkdtempSync(path.join(os.tmpdir(), "controlled-experiment-"));
    const stopDir = mkdtempSync(path.join(os.tmpdir(), "controlled-experiment-"));
    tempDirs.push(continueDir, stopDir);

    const continued = await runControlledExperiment({
      config: {
        casesPath: "examples/token-savings-cases.json",
        caseIds: ["todo-ts-create-task"],
        agents: ["fake-agent"],
        strategies: ["raw-full-file", "my-dev-kit-guided"],
        complexityLevels: ["short"],
        outDir: continueDir,
        continueOnFailure: true
      },
      cases,
      projectProfiles,
      env: { ...process.env, FAKE_AGENT_MODE: "failure" }
    });
    expect(continued.runs).toHaveLength(2);
    expect(continued.summary.failedRuns).toBe(2);

    const stopped = await runControlledExperiment({
      config: {
        casesPath: "examples/token-savings-cases.json",
        caseIds: ["todo-ts-create-task"],
        agents: ["fake-agent"],
        strategies: ["raw-full-file", "my-dev-kit-guided"],
        complexityLevels: ["short"],
        outDir: stopDir,
        continueOnFailure: false
      },
      cases,
      projectProfiles,
      env: { ...process.env, FAKE_AGENT_MODE: "failure" }
    });
    expect(stopped.runs).toHaveLength(1);
    expect(stopped.summary.failedRuns).toBe(1);
  });

  it("handles invalid output as a structured run outcome", async () => {
    const outDir = mkdtempSync(path.join(os.tmpdir(), "controlled-experiment-"));
    tempDirs.push(outDir);
    const { cases, projectProfiles } = await loadExperimentFixtures();
    const artifacts = await runControlledExperiment({
      config: {
        casesPath: "examples/token-savings-cases.json",
        caseIds: ["todo-ts-create-task"],
        agents: ["fake-agent"],
        strategies: ["raw-full-file"],
        complexityLevels: ["short"],
        outDir
      },
      cases,
      projectProfiles,
      env: { ...process.env, FAKE_AGENT_MODE: "invalid-output" }
    });
    expect(artifacts.runs[0].status).toBe("invalid-output");
    const score = JSON.parse(await readFile(path.join(outDir, "runs", artifacts.runs[0].runId, "correctness-score.json"), "utf8"));
    expect(score.passed).toBe(false);
  });
});
