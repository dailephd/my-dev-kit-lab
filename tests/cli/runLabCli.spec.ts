import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { runLabCli } from "../../src/cli/index.js";
import type { LabCliWriters } from "../../src/cli/index.js";
import { createFakeExperimentFixture } from "../report/experimentReportTestHelpers.js";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const PACKAGE_VERSION = (
  JSON.parse(readFileSync(path.join(REPO_ROOT, "package.json"), "utf8")) as { version: string }
).version;
const FAKE_KIT_COMMAND = "node tests/fixtures/fake-my-dev-kit-cli.js";

const tempDirs: string[] = [];
afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function createWriters(): { writers: LabCliWriters; stdout: string[]; stderr: string[] } {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return {
    writers: {
      stdout: (message) => {
        stdout.push(message);
      },
      stderr: (message) => {
        stderr.push(message);
      }
    },
    stdout,
    stderr
  };
}

function baseFinalDemoArgs(outDir: string): string[] {
  return [
    "--cases",
    "examples/token-savings-cases.json",
    "--out",
    outDir,
    "--kit-command",
    FAKE_KIT_COMMAND,
    "--agents",
    "fake-agent",
    "--complexities",
    "short",
    "--max-runs",
    "2",
    "--no-screenshot"
  ];
}

describe("runLabCli", () => {
  it("shows top-level help and exits 0 for no arguments", async () => {
    const { writers, stdout } = createWriters();
    const code = await runLabCli([], { writers });
    expect(code).toBe(0);
    expect(stdout.join("\n")).toContain("my-dev-kit-lab");
    expect(stdout.join("\n")).toContain("demo final");
  });

  it("shows top-level help for --help and -h", async () => {
    for (const flag of ["--help", "-h"]) {
      const { writers, stdout } = createWriters();
      const code = await runLabCli([flag], { writers });
      expect(code).toBe(0);
      expect(stdout.join("\n")).toContain("Usage:");
    }
  });

  it("lists every newly routed command and omits still-unimplemented ones in top-level help", async () => {
    const { writers, stdout } = createWriters();
    await runLabCli(["--help"], { writers });
    const output = stdout.join("\n");
    for (const routed of ["audit", "experiment controlled", "report render", "plots generate", "gallery build", "demo final", "--workspace"]) {
      expect(output).toContain(routed);
    }
    expect(output.toLowerCase()).not.toContain("security");
    expect(output).not.toContain("experiment list");
    expect(output).not.toContain("experiment describe");
    expect(output).not.toContain("experiment run");
  });

  it("prints the exact package.json version for --version and -V, independent of cwd", async () => {
    const originalCwd = process.cwd();
    const unrelatedDir = mkdtempSync(path.join(os.tmpdir(), "cli-version-cwd-"));
    tempDirs.push(unrelatedDir);
    try {
      process.chdir(unrelatedDir);
      for (const flag of ["--version", "-V"]) {
        const { writers, stdout } = createWriters();
        const code = await runLabCli([flag], { writers });
        expect(code).toBe(0);
        expect(stdout).toEqual([PACKAGE_VERSION]);
      }
    } finally {
      process.chdir(originalCwd);
    }
  });

  it("shows demo help listing the final command", async () => {
    const { writers, stdout } = createWriters();
    const code = await runLabCli(["demo", "--help"], { writers });
    expect(code).toBe(0);
    expect(stdout.join("\n")).toContain("final");
  });

  it("shows final-demo help listing the existing accepted flags", async () => {
    const { writers, stdout } = createWriters();
    const code = await runLabCli(["demo", "final", "--help"], { writers });
    expect(code).toBe(0);
    const output = stdout.join("\n");
    for (const flag of [
      "--cases",
      "--out",
      "--kit-command",
      "--agents",
      "--strategies",
      "--complexities",
      "--case",
      "--benchmark-project",
      "--max-runs",
      "--screenshot",
      "--no-screenshot",
      "--include-real-agents",
      "--continue-on-failure",
      "--no-continue-on-failure",
      "--timeout-ms"
    ]) {
      expect(output).toContain(flag);
    }
  });

  it("delegates `demo final` to the existing final-demo command owner", async () => {
    const outDir = mkdtempSync(path.join(os.tmpdir(), "cli-demo-final-"));
    tempDirs.push(outDir);
    const code = await runLabCli(["demo", "final", ...baseFinalDemoArgs(outDir)]);
    expect(code).toBe(0);
    expect(existsSync(path.join(outDir, "controlled-experiment", "experiment-summary.json"))).toBe(true);
    expect(existsSync(path.join(outDir, "gallery", "gallery-manifest.json"))).toBe(true);
  }, 15000);

  it("delegates the legacy direct invocation form to the same final-demo command owner", async () => {
    const outDir = mkdtempSync(path.join(os.tmpdir(), "cli-legacy-"));
    tempDirs.push(outDir);
    const code = await runLabCli(baseFinalDemoArgs(outDir));
    expect(code).toBe(0);
    expect(existsSync(path.join(outDir, "controlled-experiment", "experiment-summary.json"))).toBe(true);
    expect(existsSync(path.join(outDir, "gallery", "gallery-manifest.json"))).toBe(true);
  }, 15000);

  it("rejects an unknown top-level command with a usage error and exit code 2", async () => {
    const { writers, stderr } = createWriters();
    const code = await runLabCli(["nonsense"], { writers });
    expect(code).toBe(2);
    expect(stderr.join("\n")).toContain("Unknown command");
  });

  it("does not route the still-unimplemented `security` command into final-demo or any placeholder handler", async () => {
    const { writers, stderr } = createWriters();
    const code = await runLabCli(["security"], { writers });
    expect(code).toBe(2);
    expect(stderr.join("\n")).toContain("Unknown command");
  });

  it.each(["list", "describe", "run"])(
    "rejects `experiment %s` (not yet implemented) with exit code 2 and does not execute a controlled experiment",
    async (subcommand) => {
      const { writers, stderr } = createWriters();
      const code = await runLabCli(["experiment", subcommand], { writers });
      expect(code).toBe(2);
      expect(stderr.join("\n")).toContain("Unknown command");
    }
  );

  it.each([
    ["report", "nonsense"],
    ["plots", "nonsense"],
    ["gallery", "nonsense"]
  ])("rejects unknown `%s %s` subcommand with exit code 2", async (family, subcommand) => {
    const { writers, stderr } = createWriters();
    const code = await runLabCli([family, subcommand], { writers });
    expect(code).toBe(2);
    expect(stderr.join("\n")).toContain("Unknown command");
  });

  it("shows experiment family help listing the controlled command", async () => {
    const { writers, stdout } = createWriters();
    const code = await runLabCli(["experiment", "--help"], { writers });
    expect(code).toBe(0);
    expect(stdout.join("\n")).toContain("controlled");
  });

  it("shows experiment controlled help listing the existing accepted flags", async () => {
    const { writers, stdout } = createWriters();
    const code = await runLabCli(["experiment", "controlled", "--help"], { writers });
    expect(code).toBe(0);
    const output = stdout.join("\n");
    for (const flag of [
      "--cases",
      "--out",
      "--project-profiles",
      "--case",
      "--benchmark-project",
      "--agents",
      "--strategies",
      "--complexities",
      "--timeout-ms",
      "--max-runs",
      "--continue-on-failure",
      "--no-continue-on-failure",
      "--require-agents",
      "--include-real-agents",
      "--command-template-codex",
      "--command-template-claude"
    ]) {
      expect(output).toContain(flag);
    }
  });

  it("shows report family help listing the render command", async () => {
    const { writers, stdout } = createWriters();
    const code = await runLabCli(["report", "--help"], { writers });
    expect(code).toBe(0);
    expect(stdout.join("\n")).toContain("render");
  });

  it("shows report render help listing the existing accepted flags", async () => {
    const { writers, stdout } = createWriters();
    const code = await runLabCli(["report", "render", "--help"], { writers });
    expect(code).toBe(0);
    const output = stdout.join("\n");
    for (const flag of [
      "--experiment",
      "--out",
      "--title",
      "--subtitle",
      "--screenshot",
      "--no-screenshot",
      "--require-screenshot",
      "--max-prompt-chars",
      "--max-file-tree-entries",
      "--plots",
      "--visualizations"
    ]) {
      expect(output).toContain(flag);
    }
  });

  it("shows plots family help listing the generate command", async () => {
    const { writers, stdout } = createWriters();
    const code = await runLabCli(["plots", "--help"], { writers });
    expect(code).toBe(0);
    expect(stdout.join("\n")).toContain("generate");
  });

  it("shows plots generate help listing the existing accepted flags", async () => {
    const { writers, stdout } = createWriters();
    const code = await runLabCli(["plots", "generate", "--help"], { writers });
    expect(code).toBe(0);
    const output = stdout.join("\n");
    expect(output).toContain("--experiment");
    expect(output).toContain("--out");
  });

  it("shows gallery family help listing the build command", async () => {
    const { writers, stdout } = createWriters();
    const code = await runLabCli(["gallery", "--help"], { writers });
    expect(code).toBe(0);
    expect(stdout.join("\n")).toContain("build");
  });

  it("shows gallery build help listing the existing accepted flags", async () => {
    const { writers, stdout } = createWriters();
    const code = await runLabCli(["gallery", "build", "--help"], { writers });
    expect(code).toBe(0);
    const output = stdout.join("\n");
    for (const flag of ["--report", "--plots", "--visualizations", "--experiment", "--out"]) {
      expect(output).toContain(flag);
    }
  });

  it("returns the final-demo command owner's failure code rather than converting it to success", async () => {
    const code = await runLabCli(["demo", "final", "--cases", "examples/token-savings-cases.json"]);
    expect(code).toBe(1);
  });

  it("returns the final-demo command owner's failure code for the legacy invocation form too", async () => {
    const code = await runLabCli(["--cases", "examples/token-savings-cases.json"]);
    expect(code).toBe(1);
  });

  it("delegates `experiment controlled` to the existing controlled-experiment command owner", async () => {
    const outDir = mkdtempSync(path.join(os.tmpdir(), "cli-experiment-controlled-"));
    tempDirs.push(outDir);
    const code = await runLabCli([
      "experiment",
      "controlled",
      "--cases",
      "examples/token-savings-cases.json",
      "--case",
      "todo-ts-create-task",
      "--agents",
      "fake-agent",
      "--strategies",
      "raw-full-file,my-dev-kit-guided",
      "--complexities",
      "short",
      "--out",
      outDir
    ]);
    expect(code).toBe(0);
    expect(existsSync(path.join(outDir, "experiment-summary.json"))).toBe(true);
    const summary = JSON.parse(readFileSync(path.join(outDir, "experiment-summary.json"), "utf8"));
    expect(summary.totalRuns).toBe(2);
  });

  it("delegates `report render` to the existing render-experiment-report command owner", async () => {
    const experimentDir = await createFakeExperimentFixture();
    const outDir = mkdtempSync(path.join(os.tmpdir(), "cli-report-render-"));
    tempDirs.push(experimentDir, outDir);
    const code = await runLabCli(["report", "render", "--experiment", experimentDir, "--out", outDir]);
    expect(code).toBe(0);
    expect(existsSync(path.join(outDir, "experiment-report.html"))).toBe(true);
    expect(existsSync(path.join(outDir, "experiment-report.json"))).toBe(true);
  });

  it("delegates `plots generate` to the existing generate-experiment-plots command owner", async () => {
    const experimentDir = await createFakeExperimentFixture();
    const outDir = mkdtempSync(path.join(os.tmpdir(), "cli-plots-generate-"));
    tempDirs.push(experimentDir, outDir);
    const code = await runLabCli(["plots", "generate", "--experiment", experimentDir, "--out", outDir]);
    expect(code).toBe(0);
    expect(existsSync(path.join(outDir, "plot-data.json"))).toBe(true);
  });

  it("delegates `gallery build` to the existing build-gallery command owner", async () => {
    const experimentDir = await createFakeExperimentFixture();
    const outDir = mkdtempSync(path.join(os.tmpdir(), "cli-gallery-build-"));
    tempDirs.push(experimentDir, outDir);
    const code = await runLabCli(["gallery", "build", "--experiment", experimentDir, "--out", outDir]);
    expect(code).toBe(0);
    expect(existsSync(path.join(outDir, "gallery-manifest.json"))).toBe(true);
    expect(existsSync(path.join(outDir, "gallery-index.html"))).toBe(true);
  });

  it("returns the routed command owner's failure code rather than converting it to success", async () => {
    const code = await runLabCli(["experiment", "controlled", "--cases", "examples/token-savings-cases.json"]);
    expect(code).toBe(1);
  });
});
