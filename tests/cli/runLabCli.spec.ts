import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { runLabCli } from "../../src/cli/index.js";
import type { LabCliWriters } from "../../src/cli/index.js";

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

  it("does not list unrouted command families in top-level help", async () => {
    const { writers, stdout } = createWriters();
    await runLabCli(["--help"], { writers });
    const output = stdout.join("\n").toLowerCase();
    for (const family of ["security", "audit", "experiment", "report", "plots", "gallery"]) {
      expect(output).not.toContain(family);
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

  it.each(["security", "experiment", "audit"])(
    "does not route %s into final-demo or any placeholder handler yet",
    async (family) => {
      const { writers, stderr } = createWriters();
      const code = await runLabCli([family], { writers });
      expect(code).toBe(2);
      expect(stderr.join("\n")).toContain("Unknown command");
    }
  );

  it("returns the final-demo command owner's failure code rather than converting it to success", async () => {
    const code = await runLabCli(["demo", "final", "--cases", "examples/token-savings-cases.json"]);
    expect(code).toBe(1);
  });

  it("returns the final-demo command owner's failure code for the legacy invocation form too", async () => {
    const code = await runLabCli(["--cases", "examples/token-savings-cases.json"]);
    expect(code).toBe(1);
  });
});
