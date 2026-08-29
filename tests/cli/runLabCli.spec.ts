import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
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
  vi.restoreAllMocks();
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

// Some routed command owners (security validate, experiment list/describe)
// print via raw console.log/console.error rather than the router's
// injectable writers, matching every other delegated command owner. Spy on
// the real console for tests that need to inspect their output.
function spyOnConsole(): { logSpy: ReturnType<typeof vi.spyOn>; errorSpy: ReturnType<typeof vi.spyOn> } {
  return {
    logSpy: vi.spyOn(console, "log").mockImplementation(() => {}),
    errorSpy: vi.spyOn(console, "error").mockImplementation(() => {})
  };
}

function joinSpyCalls(spy: ReturnType<typeof vi.spyOn>): string {
  return spy.mock.calls.map((call) => call.join(" ")).join("\n");
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

  it("lists every routed command and omits still-unimplemented ones in top-level help", async () => {
    const { writers, stdout } = createWriters();
    await runLabCli(["--help"], { writers });
    const output = stdout.join("\n");
    for (const routed of [
      "security validate",
      "audit",
      "experiment list",
      "experiment describe",
      "experiment run",
      "experiment controlled",
      "report render",
      "plots generate",
      "gallery build",
      "demo final",
      "--workspace"
    ]) {
      expect(output).toContain(routed);
    }
    for (const notYetRouted of [
      "security deps",
      "security package",
      "security codeql",
      "security semgrep",
      "security fuzz",
      "visualization"
    ]) {
      expect(output).not.toContain(notYetRouted);
    }
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

  it.each(["deps", "package", "codeql", "semgrep", "fuzz"])(
    "rejects developer-only `security %s` with exit code 2 (stays private)",
    async (subcommand) => {
      const { writers, stderr } = createWriters();
      const code = await runLabCli(["security", subcommand], { writers });
      expect(code).toBe(2);
      expect(stderr.join("\n")).toContain("Unknown command");
    }
  );

  it("does not route `security` alone (no subcommand) into validate", async () => {
    const { writers, stdout } = createWriters();
    const code = await runLabCli(["security"], { writers });
    expect(code).toBe(0);
    expect(stdout.join("\n")).toContain("validate");
  });

  it.each([
    ["experiment", "bogus"],
    ["report", "nonsense"],
    ["plots", "nonsense"],
    ["gallery", "nonsense"]
  ])("rejects unknown `%s %s` subcommand with exit code 2", async (family, subcommand) => {
    const { writers, stderr } = createWriters();
    const code = await runLabCli([family, subcommand], { writers });
    expect(code).toBe(2);
    expect(stderr.join("\n")).toContain("Unknown command");
  });

  it("shows experiment family help listing list/describe/run/controlled", async () => {
    const { writers, stdout } = createWriters();
    const code = await runLabCli(["experiment", "--help"], { writers });
    expect(code).toBe(0);
    const output = stdout.join("\n");
    expect(output).toContain("list");
    expect(output).toContain("describe");
    expect(output).toContain("run");
    expect(output).toContain("controlled");
  });

  it("shows security family help listing the validate command", async () => {
    const { writers, stdout } = createWriters();
    const code = await runLabCli(["security", "--help"], { writers });
    expect(code).toBe(0);
    expect(stdout.join("\n")).toContain("validate");
  });

  it("shows security validate help reflecting the actual current parser", async () => {
    const { logSpy } = spyOnConsole();
    const code = await runLabCli(["security", "validate", "--help"]);
    expect(code).toBe(0);
    const output = joinSpyCalls(logSpy);
    for (const flag of [
      "--target",
      "--out",
      "--report-prefix",
      "--checks",
      "--profile",
      "--format",
      "--fail-on",
      "--android-gradle-operations",
      "--android-external-tools",
      "--android-external-network"
    ]) {
      expect(output).toContain(flag);
    }
  });

  it("shows experiment list help", async () => {
    const { writers, stdout } = createWriters();
    const code = await runLabCli(["experiment", "list", "--help"], { writers });
    expect(code).toBe(0);
    expect(stdout.join("\n")).toContain("--json");
  });

  it("shows experiment describe help", async () => {
    const { writers, stdout } = createWriters();
    const code = await runLabCli(["experiment", "describe", "--help"], { writers });
    expect(code).toBe(0);
    expect(stdout.join("\n")).toContain("--experiment");
  });

  it("shows experiment run help reflecting the actual current parser", async () => {
    const { writers, stdout } = createWriters();
    const code = await runLabCli(["experiment", "run", "--help"], { writers });
    expect(code).toBe(0);
    const output = stdout.join("\n");
    for (const flag of [
      "--experiment",
      "--target",
      "--out",
      "--cases",
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

  it("delegates `experiment list` to the existing experiment registry", async () => {
    const { logSpy } = spyOnConsole();
    const code = await runLabCli(["experiment", "list"]);
    expect(code).toBe(0);
    const output = joinSpyCalls(logSpy);
    expect(output).toContain("context-strategy-comparison");
    expect(output).toContain("raw-full-file");
    expect(output).toContain("my-dev-kit-guided");
  });

  it("delegates `experiment describe` to the existing experiment registry", async () => {
    const { logSpy } = spyOnConsole();
    const code = await runLabCli(["experiment", "describe", "--experiment", "context-strategy-comparison"]);
    expect(code).toBe(0);
    const output = joinSpyCalls(logSpy);
    expect(output).toContain("Context Strategy Comparison");
    expect(output).toContain("Purpose:");
  });

  it("returns exit 1 for `experiment describe` on an unknown plugin, unchanged", async () => {
    const { errorSpy } = spyOnConsole();
    const code = await runLabCli(["experiment", "describe", "--experiment", "does-not-exist"]);
    expect(code).toBe(1);
    expect(joinSpyCalls(errorSpy)).toContain("Experiment plugin not found: does-not-exist");
  });
});
