import { existsSync, mkdtempSync } from "node:fs";
import { readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runFinalDemoCommand } from "../../src/commands/runFinalDemoCommand.js";

const tempDirs: string[] = [];
afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("final demo fake integration", () => {
  it("runs final fake workflow without screenshot by default", async () => {
    const outDir = mkdtempSync(path.join(os.tmpdir(), "final-demo-integration-"));
    tempDirs.push(outDir);
    expect(
      await runFinalDemoCommand([
        "--cases",
        "examples/token-savings-cases.json",
        "--out",
        outDir,
        "--kit-command",
        "node tests/fixtures/fake-my-dev-kit-cli.js",
        "--agents",
        "fake-agent",
        "--complexities",
        "short",
        "--max-runs",
        "2",
        "--no-screenshot"
      ])
    ).toBe(0);
    const html = await readFile(path.join(outDir, "experiment-report", "experiment-report.html"), "utf8");
    expect(html).toContain("Plots");
    expect(html).toContain("my-dev-kit Visualization Demos");
    expect(existsSync(path.join(outDir, "experiment-plots", "charts", "run-outcomes-by-agent.svg"))).toBe(true);
    expect(existsSync(path.join(outDir, "experiment-report", "experiment-report.png"))).toBe(false);
  });
});
