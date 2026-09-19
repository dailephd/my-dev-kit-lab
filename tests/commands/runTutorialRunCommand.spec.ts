import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runTutorialRunCommandFromArgs } from "../../src/commands/runTutorialRunCommand.js";
import { createLabExecutionContext } from "../../src/runtime/labExecutionContext.js";
import type { RunTutorialOptions, TutorialRunResultV1 } from "../../src/tutorial/index.js";

const tempDirs: string[] = [];
afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function makeTempDir(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "tutorial-run-cli-"));
  tempDirs.push(dir);
  return dir;
}

function createWriters(): {
  writers: { stdout: (m: string) => void; stderr: (m: string) => void };
  stdout: string[];
  stderr: string[];
} {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return {
    writers: { stdout: (m) => stdout.push(m), stderr: (m) => stderr.push(m) },
    stdout,
    stderr
  };
}

function fakeResult(overrides: Partial<TutorialRunResultV1> = {}): TutorialRunResultV1 {
  return {
    schemaVersion: "1.0.0",
    scenarioId: "demo-tutorial",
    targetId: "demo-target",
    runId: "run-1",
    status: "passed",
    startedAt: "2026-09-18T12:00:00.000Z",
    endedAt: "2026-09-18T12:00:01.000Z",
    durationMs: 1000,
    paths: {
      runRoot: "/runs/demo",
      targetRoot: "/runs/demo/target",
      artifactsRoot: "/runs/demo/artifacts",
      screenshotsRoot: "/runs/demo/screenshots",
      logsRoot: "/runs/demo/logs",
      temporaryRoot: "/runs/demo/temporary"
    },
    steps: [
      { id: "one", status: "passed", assertions: [], screenshotRequested: false, highlightRequested: false, calloutRequested: false }
    ],
    artifacts: {
      video: { kind: "video", status: "written", path: "artifacts/tutorial.webm", sizeBytes: 2048 },
      srt: { kind: "srt", status: "written", path: "artifacts/tutorial.srt", sizeBytes: 64 },
      vtt: { kind: "vtt", status: "written", path: "artifacts/tutorial.vtt", sizeBytes: 70 },
      markdown: { kind: "markdown", status: "written", path: "artifacts/tutorial.md", sizeBytes: 128 },
      manifest: { kind: "manifest", status: "written", path: "artifacts/tutorial-manifest.json", sizeBytes: 512 },
      screenshots: [
        { kind: "screenshot", id: "one", status: "written", path: "screenshots/one.png", sizeBytes: 900 }
      ]
    },
    warnings: [],
    cleanupErrors: [],
    ...overrides
  };
}

function capturingImpl(
  result: TutorialRunResultV1,
  captured: RunTutorialOptions[]
): (options: RunTutorialOptions) => Promise<TutorialRunResultV1> {
  return async (options) => {
    captured.push(options);
    return result;
  };
}

describe("runTutorialRunCommandFromArgs", () => {
  it("returns 2 when --scenario is missing", async () => {
    const { writers, stderr } = createWriters();
    const exitCode = await runTutorialRunCommandFromArgs(["--target-contract", "t.json"], {
      writers,
      context: createLabExecutionContext({ invocationCwd: makeTempDir() }),
      runTutorialImpl: async () => {
        throw new Error("must not run");
      }
    });

    expect(exitCode).toBe(2);
    expect(stderr.join("\n")).toContain("Missing required --scenario");
  });

  it("returns 2 when --target-contract is missing", async () => {
    const { writers, stderr } = createWriters();
    const exitCode = await runTutorialRunCommandFromArgs(["--scenario", "s.json"], {
      writers,
      context: createLabExecutionContext({ invocationCwd: makeTempDir() }),
      runTutorialImpl: async () => {
        throw new Error("must not run");
      }
    });

    expect(exitCode).toBe(2);
    expect(stderr.join("\n")).toContain("Missing required --target-contract");
  });

  it("returns 2 for options the batch deliberately does not expose", async () => {
    for (const rejected of ["--url", "--eval", "--script", "--command", "--browser-executable", "--run-id"]) {
      const { writers, stderr } = createWriters();
      const exitCode = await runTutorialRunCommandFromArgs(
        ["--scenario", "s.json", "--target-contract", "t.json", rejected, "x"],
        {
          writers,
          context: createLabExecutionContext({ invocationCwd: makeTempDir() }),
          runTutorialImpl: async () => {
            throw new Error("must not run");
          }
        }
      );
      expect(exitCode).toBe(2);
      expect(stderr.join("\n")).toContain(`Unknown argument for "tutorial run": ${rejected}`);
    }
  });

  it("returns 0 and prints a concise summary for a passing run", async () => {
    const captured: RunTutorialOptions[] = [];
    const { writers, stdout } = createWriters();

    const exitCode = await runTutorialRunCommandFromArgs(
      ["--scenario", "s.json", "--target-contract", "t.json"],
      {
        writers,
        context: createLabExecutionContext({ invocationCwd: makeTempDir() }),
        runTutorialImpl: capturingImpl(fakeResult(), captured)
      }
    );

    expect(exitCode).toBe(0);
    const output = stdout.join("\n");
    expect(output).toContain("Scenario ID: demo-tutorial");
    expect(output).toContain("Target ID: demo-target");
    expect(output).toContain("Run ID: run-1");
    expect(output).toContain("Run root: /runs/demo");
    expect(output).toContain("Status: passed");
    expect(captured[0].scenarioPath).toBe("s.json");
    expect(captured[0].targetContractPath).toBe("t.json");
    expect(captured[0].outDir).toBeUndefined();
  });

  it("returns 1 for every non-passing run status", async () => {
    for (const status of [
      "scenario-invalid",
      "target-invalid",
      "target-mismatch",
      "prepare-failed",
      "process-start-failed",
      "readiness-failed",
      "browser-unavailable",
      "browser-failed",
      "step-failed",
      "cleanup-failed"
    ] as const) {
      const { writers } = createWriters();
      const exitCode = await runTutorialRunCommandFromArgs(
        ["--scenario", "s.json", "--target-contract", "t.json"],
        {
          writers,
          context: createLabExecutionContext({ invocationCwd: makeTempDir() }),
          runTutorialImpl: async () => fakeResult({ status, error: `failed with ${status}` })
        }
      );
      expect(exitCode).toBe(1);
    }
  });

  it("names the failed step and primary error in the summary", async () => {
    const { writers, stdout } = createWriters();
    await runTutorialRunCommandFromArgs(["--scenario", "s.json", "--target-contract", "t.json"], {
      writers,
      context: createLabExecutionContext({ invocationCwd: makeTempDir() }),
      runTutorialImpl: async () =>
        fakeResult({
          status: "step-failed",
          error: "Step \"associate-header\" failed because the click action failed: boom",
          steps: [
            { id: "first", status: "passed", assertions: [], screenshotRequested: false, highlightRequested: false, calloutRequested: false },
            { id: "associate-header", status: "failed", assertions: [], screenshotRequested: false, highlightRequested: false, calloutRequested: false },
            { id: "later", status: "not-run", assertions: [], screenshotRequested: false, highlightRequested: false, calloutRequested: false }
          ]
        })
    });

    const output = stdout.join("\n");
    expect(output).toContain("Steps: 3 (passed 1, failed 1, not-run 1)");
    expect(output).toContain("Failed step: associate-header");
    expect(output).toContain("Error: Step \"associate-header\" failed");
  });

  it("prints parseable TutorialRunResultV1 JSON with --json", async () => {
    const { writers, stdout } = createWriters();
    const exitCode = await runTutorialRunCommandFromArgs(
      ["--scenario", "s.json", "--target-contract", "t.json", "--json"],
      {
        writers,
        context: createLabExecutionContext({ invocationCwd: makeTempDir() }),
        runTutorialImpl: async () => fakeResult()
      }
    );

    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout.join("\n")) as TutorialRunResultV1;
    expect(parsed.schemaVersion).toBe("1.0.0");
    expect(parsed.status).toBe("passed");
    expect(parsed.steps).toHaveLength(1);
  });

  it("forwards an explicit --out to the tutorial runtime", async () => {
    const captured: RunTutorialOptions[] = [];
    const { writers } = createWriters();

    await runTutorialRunCommandFromArgs(
      ["--scenario", "s.json", "--target-contract", "t.json", "--out", "runs/one"],
      {
        writers,
        context: createLabExecutionContext({ invocationCwd: makeTempDir() }),
        runTutorialImpl: capturingImpl(fakeResult(), captured)
      }
    );

    expect(captured[0].outDir).toBe("runs/one");
  });

  it("forwards the execution context so workspace selection reaches the runtime", async () => {
    const captured: RunTutorialOptions[] = [];
    const workspaceRoot = makeTempDir();
    const invocationCwd = makeTempDir();
    const { writers } = createWriters();

    await runTutorialRunCommandFromArgs(["--scenario", "s.json", "--target-contract", "t.json"], {
      writers,
      context: createLabExecutionContext({ invocationCwd, workspaceRoot }),
      runTutorialImpl: capturingImpl(fakeResult(), captured)
    });

    expect(captured[0].context.workspaceRoot).toBe(path.resolve(workspaceRoot));
    expect(captured[0].context.invocationCwd).toBe(path.resolve(invocationCwd));
  });

  it("reports cleanup errors and warnings without dumping process logs", async () => {
    const { writers, stdout } = createWriters();
    await runTutorialRunCommandFromArgs(["--scenario", "s.json", "--target-contract", "t.json"], {
      writers,
      context: createLabExecutionContext({ invocationCwd: makeTempDir() }),
      runTutorialImpl: async () =>
        fakeResult({
          status: "cleanup-failed",
          warnings: ["a warning"],
          cleanupErrors: ["context refused to close"]
        })
    });

    const output = stdout.join("\n");
    expect(output).toContain("Warning: a warning");
    expect(output).toContain("Cleanup error: context refused to close");
    expect(output).not.toContain("stdout.txt");
  });
});
