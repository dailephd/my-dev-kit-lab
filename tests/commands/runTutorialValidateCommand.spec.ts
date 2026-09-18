import { mkdtempSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runTutorialValidateCommandFromArgs } from "../../src/commands/runTutorialValidateCommand.js";
import { createLabExecutionContext } from "../../src/runtime/labExecutionContext.js";
import { minimalScenario, minimalTargetContract } from "../tutorial/tutorialTestHelpers.js";

const tempDirs: string[] = [];
afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function makeFixtureDir(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "tutorial-validate-"));
  tempDirs.push(dir);
  return dir;
}

function writeJson(dir: string, name: string, value: unknown): string {
  const filePath = path.join(dir, name);
  writeFileSync(filePath, JSON.stringify(value, null, 2), "utf8");
  return filePath;
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

function contextFor(dir: string) {
  return createLabExecutionContext({ invocationCwd: dir, workspaceRoot: path.join(dir, "workspace") });
}

describe("runTutorialValidateCommandFromArgs", () => {
  it("returns 2 when --scenario is missing", async () => {
    const { writers, stderr } = createWriters();
    const exitCode = await runTutorialValidateCommandFromArgs([], { writers, context: contextFor(makeFixtureDir()) });

    expect(exitCode).toBe(2);
    expect(stderr.join("\n")).toContain("Missing required --scenario");
  });

  it("returns 2 when --scenario has no value", async () => {
    const { writers, stderr } = createWriters();
    const exitCode = await runTutorialValidateCommandFromArgs(["--scenario"], {
      writers,
      context: contextFor(makeFixtureDir())
    });

    expect(exitCode).toBe(2);
    expect(stderr.join("\n")).toContain("Missing value for --scenario");
  });

  it("returns 2 for an unknown option", async () => {
    const { writers, stderr } = createWriters();
    const exitCode = await runTutorialValidateCommandFromArgs(["--scenario", "a.json", "--eval", "x"], {
      writers,
      context: contextFor(makeFixtureDir())
    });

    expect(exitCode).toBe(2);
    expect(stderr.join("\n")).toContain("Unknown argument");
  });

  it("returns 0 for a valid scenario and prints a concise summary", async () => {
    const dir = makeFixtureDir();
    writeJson(dir, "scenario.json", minimalScenario());
    const { writers, stdout } = createWriters();

    const exitCode = await runTutorialValidateCommandFromArgs(["--scenario", "scenario.json"], {
      writers,
      context: contextFor(dir)
    });

    expect(exitCode).toBe(0);
    const output = stdout.join("\n");
    expect(output).toContain("Scenario ID: demo-tutorial");
    expect(output).toContain("Status: valid");
  });

  it("returns 1 for an invalid scenario and names the failing location", async () => {
    const dir = makeFixtureDir();
    writeJson(dir, "scenario.json", minimalScenario({ steps: [] }));
    const { writers, stdout } = createWriters();

    const exitCode = await runTutorialValidateCommandFromArgs(["--scenario", "scenario.json"], {
      writers,
      context: contextFor(dir)
    });

    expect(exitCode).toBe(1);
    const output = stdout.join("\n");
    expect(output).toContain("Status: invalid");
    expect(output).toContain("at least one step");
  });

  it("returns 1 when the scenario file does not exist", async () => {
    const dir = makeFixtureDir();
    const { writers, stdout } = createWriters();

    const exitCode = await runTutorialValidateCommandFromArgs(["--scenario", "absent.json"], {
      writers,
      context: contextFor(dir)
    });

    expect(exitCode).toBe(1);
    expect(stdout.join("\n")).toContain("could not be read");
  });

  it("returns 0 when a matching scenario and target contract are supplied", async () => {
    const dir = makeFixtureDir();
    writeJson(dir, "scenario.json", minimalScenario());
    writeJson(dir, "target.json", minimalTargetContract());
    const { writers, stdout } = createWriters();

    const exitCode = await runTutorialValidateCommandFromArgs(
      ["--scenario", "scenario.json", "--target-contract", "target.json"],
      { writers, context: contextFor(dir) }
    );

    expect(exitCode).toBe(0);
    const output = stdout.join("\n");
    expect(output).toContain("Target contract ID: demo-target");
    expect(output).toContain("Managed processes: 1");
    expect(output).toContain("Status: valid");
  });

  it("returns 1 when the scenario targetId does not match the contract id", async () => {
    const dir = makeFixtureDir();
    writeJson(dir, "scenario.json", minimalScenario({ targetId: "other-demo" }));
    writeJson(dir, "target.json", minimalTargetContract());
    const { writers, stdout } = createWriters();

    const exitCode = await runTutorialValidateCommandFromArgs(
      ["--scenario", "scenario.json", "--target-contract", "target.json"],
      { writers, context: contextFor(dir) }
    );

    expect(exitCode).toBe(1);
    expect(stdout.join("\n")).toContain('does not match target contract id "demo-target"');
  });

  it("returns 1 for an invalid target contract", async () => {
    const dir = makeFixtureDir();
    writeJson(dir, "scenario.json", minimalScenario());
    writeJson(dir, "target.json", minimalTargetContract({ applicationUrl: "http://example.com/" }));
    const { writers, stdout } = createWriters();

    const exitCode = await runTutorialValidateCommandFromArgs(
      ["--scenario", "scenario.json", "--target-contract", "target.json"],
      { writers, context: contextFor(dir) }
    );

    expect(exitCode).toBe(1);
    expect(stdout.join("\n")).toContain("loopback hostname");
  });

  it("prints deterministic parseable JSON with --json", async () => {
    const dir = makeFixtureDir();
    writeJson(dir, "scenario.json", minimalScenario());
    writeJson(dir, "target.json", minimalTargetContract());
    const first = createWriters();
    const second = createWriters();

    const exitCode = await runTutorialValidateCommandFromArgs(
      ["--scenario", "scenario.json", "--target-contract", "target.json", "--json"],
      { writers: first.writers, context: contextFor(dir) }
    );
    await runTutorialValidateCommandFromArgs(
      ["--scenario", "scenario.json", "--target-contract", "target.json", "--json"],
      { writers: second.writers, context: contextFor(dir) }
    );

    expect(exitCode).toBe(0);
    expect(first.stdout.join("\n")).toBe(second.stdout.join("\n"));
    const parsed = JSON.parse(first.stdout.join("\n")) as Record<string, unknown>;
    expect(parsed.status).toBe("valid");
    expect(parsed.scenarioId).toBe("demo-tutorial");
    expect(parsed.targetContractId).toBe("demo-target");
    expect(parsed.targetIdMatches).toBe(true);
    expect(parsed.errors).toEqual([]);
  });

  it("resolves an absolute scenario path as supplied", async () => {
    const dir = makeFixtureDir();
    const scenarioPath = writeJson(dir, "scenario.json", minimalScenario());
    const otherCwd = makeFixtureDir();
    const { writers } = createWriters();

    const exitCode = await runTutorialValidateCommandFromArgs(["--scenario", scenarioPath], {
      writers,
      context: contextFor(otherCwd)
    });

    expect(exitCode).toBe(0);
  });

  it("does not create any output directory", async () => {
    const dir = makeFixtureDir();
    writeJson(dir, "scenario.json", minimalScenario());
    const context = contextFor(dir);
    const { writers } = createWriters();

    await runTutorialValidateCommandFromArgs(["--scenario", "scenario.json"], { writers, context });

    const { existsSync } = await import("node:fs");
    expect(existsSync(context.workspaceRoot)).toBe(false);
  });
});
