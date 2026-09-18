import { mkdtempSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runLabCli } from "../../src/cli/index.js";
import type { LabCliWriters } from "../../src/cli/index.js";
import { minimalScenario, minimalTargetContract } from "../tutorial/tutorialTestHelpers.js";

const tempDirs: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function makeTempDir(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "tutorial-route-"));
  tempDirs.push(dir);
  return dir;
}

function createWriters(): { writers: LabCliWriters; stdout: string[]; stderr: string[] } {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return {
    writers: { stdout: (m) => stdout.push(m), stderr: (m) => stderr.push(m) },
    stdout,
    stderr
  };
}

/**
 * The tutorial validate command owner prints through raw console.log, matching
 * every other delegated owner in this repository, so routed-output assertions
 * spy on the console rather than the router's writers.
 */
function spyOnConsole(): { log: ReturnType<typeof vi.spyOn> } {
  return { log: vi.spyOn(console, "log").mockImplementation(() => {}) };
}

function joinSpy(spy: ReturnType<typeof vi.spyOn>): string {
  return spy.mock.calls.map((call) => call.join(" ")).join("\n");
}

describe("tutorial CLI route", () => {
  it("prints tutorial family help for --help and for a bare family invocation", async () => {
    for (const argv of [["tutorial"], ["tutorial", "--help"], ["tutorial", "-h"]]) {
      const { writers, stdout } = createWriters();
      const exitCode = await runLabCli(argv, { writers });

      expect(exitCode).toBe(0);
      expect(stdout.join("\n")).toContain("my-dev-kit-lab tutorial - declarative browser tutorial command family");
    }
  });

  it("prints tutorial validate help", async () => {
    const { writers, stdout } = createWriters();
    const exitCode = await runLabCli(["tutorial", "validate", "--help"], { writers });

    expect(exitCode).toBe(0);
    const output = stdout.join("\n");
    expect(output).toContain("my-dev-kit-lab tutorial validate - validate tutorial contracts");
    expect(output).toContain("--target-contract <path>");
  });

  it("prints tutorial run help including the default output layout", async () => {
    const { writers, stdout } = createWriters();
    const exitCode = await runLabCli(["tutorial", "run", "--help"], { writers });

    expect(exitCode).toBe(0);
    const output = stdout.join("\n");
    expect(output).toContain("my-dev-kit-lab tutorial run - run a declarative browser tutorial scenario");
    expect(output).toContain("<workspace>/tutorials/<scenario-id>/<run-id>/");
  });

  it("lists the tutorial family in top-level help", async () => {
    const { writers, stdout } = createWriters();
    await runLabCli(["--help"], { writers });

    const output = stdout.join("\n");
    expect(output).toContain("tutorial validate");
    expect(output).toContain("tutorial run");
  });

  // Scoped to the tutorial help text: the pre-existing gallery line legitimately
  // mentions a gallery manifest, which is unrelated to tutorial artifacts.
  it("does not advertise later-batch artifact behavior as implemented", async () => {
    const { writers, stdout } = createWriters();
    await runLabCli(["tutorial", "--help"], { writers });
    await runLabCli(["tutorial", "run", "--help"], { writers });
    await runLabCli(["tutorial", "validate", "--help"], { writers });

    const output = stdout.join("\n").toLowerCase();
    for (const notYet of [
      "webm",
      "video",
      "subtitle",
      ".srt",
      ".vtt",
      "tutorial.md",
      "tutorial-manifest",
      "callout",
      "cursor",
      "screenshot"
    ]) {
      expect(output).not.toContain(notYet);
    }
  });

  it("returns 2 for an unknown tutorial subcommand", async () => {
    const { writers, stderr } = createWriters();
    const exitCode = await runLabCli(["tutorial", "bogus"], { writers });

    expect(exitCode).toBe(2);
    expect(stderr.join("\n")).toContain("Unknown command: tutorial bogus");
  });

  it("returns 2 when validate is invoked without --scenario", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { writers } = createWriters();
    const exitCode = await runLabCli(["tutorial", "validate"], { writers });

    expect(exitCode).toBe(2);
  });

  it("returns 0 for a valid scenario routed through the installed CLI", async () => {
    const dir = makeTempDir();
    const scenarioPath = path.join(dir, "scenario.json");
    writeFileSync(scenarioPath, JSON.stringify(minimalScenario()), "utf8");
    const { log } = spyOnConsole();
    const { writers } = createWriters();

    const exitCode = await runLabCli(["tutorial", "validate", "--scenario", scenarioPath], { writers });

    expect(exitCode).toBe(0);
    expect(joinSpy(log)).toContain("Status: valid");
  });

  it("returns 1 for an invalid scenario routed through the installed CLI", async () => {
    const dir = makeTempDir();
    const scenarioPath = path.join(dir, "scenario.json");
    writeFileSync(scenarioPath, JSON.stringify(minimalScenario({ steps: [] })), "utf8");
    const { log } = spyOnConsole();
    const { writers } = createWriters();

    const exitCode = await runLabCli(["tutorial", "validate", "--scenario", scenarioPath], { writers });

    expect(exitCode).toBe(1);
    expect(joinSpy(log)).toContain("Status: invalid");
  });

  it("returns 1 for a mismatched scenario and target contract", async () => {
    const dir = makeTempDir();
    const scenarioPath = path.join(dir, "scenario.json");
    const targetPath = path.join(dir, "target.json");
    writeFileSync(scenarioPath, JSON.stringify(minimalScenario({ targetId: "other-demo" })), "utf8");
    writeFileSync(targetPath, JSON.stringify(minimalTargetContract()), "utf8");
    const { log } = spyOnConsole();
    const { writers } = createWriters();

    const exitCode = await runLabCli(
      ["tutorial", "validate", "--scenario", scenarioPath, "--target-contract", targetPath],
      { writers }
    );

    expect(exitCode).toBe(1);
    expect(joinSpy(log)).toContain("does not match target contract id");
  });

  it("emits parseable JSON through the installed route", async () => {
    const dir = makeTempDir();
    const scenarioPath = path.join(dir, "scenario.json");
    writeFileSync(scenarioPath, JSON.stringify(minimalScenario()), "utf8");
    const { log } = spyOnConsole();
    const { writers } = createWriters();

    const exitCode = await runLabCli(["tutorial", "validate", "--scenario", scenarioPath, "--json"], { writers });

    expect(exitCode).toBe(0);
    const parsed = JSON.parse(joinSpy(log)) as { status: string };
    expect(parsed.status).toBe("valid");
  });

  it("returns 2 when run is invoked without required contract options", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { writers } = createWriters();

    expect(await runLabCli(["tutorial", "run"], { writers })).toBe(2);
    expect(await runLabCli(["tutorial", "run", "--scenario", "s.json"], { writers })).toBe(2);
    expect(await runLabCli(["tutorial", "run", "--target-contract", "t.json"], { writers })).toBe(2);
  });

  it("keeps --workspace a leading global option that selects the default tutorial output root", async () => {
    const workspaceRoot = makeTempDir();
    const dir = makeTempDir();
    const scenarioPath = path.join(dir, "scenario.json");
    const targetPath = path.join(dir, "target.json");
    writeFileSync(scenarioPath, JSON.stringify(minimalScenario()), "utf8");
    writeFileSync(targetPath, JSON.stringify(minimalTargetContract()), "utf8");
    const { log } = spyOnConsole();
    const { writers } = createWriters();

    // The prepare command in this contract does not exist, so the run stops at
    // prepare -- but the run root has already been computed from --workspace,
    // which is what this test is proving.
    const exitCode = await runLabCli(
      ["--workspace", workspaceRoot, "tutorial", "run", "--scenario", scenarioPath, "--target-contract", targetPath, "--json"],
      { writers }
    );

    expect(exitCode).toBe(1);
    const parsed = JSON.parse(joinSpy(log)) as { paths?: { runRoot: string }; status: string };
    expect(parsed.paths?.runRoot.startsWith(path.resolve(workspaceRoot))).toBe(true);
    expect(parsed.paths?.runRoot).toContain(path.join("tutorials", "demo-tutorial"));
  });
});
