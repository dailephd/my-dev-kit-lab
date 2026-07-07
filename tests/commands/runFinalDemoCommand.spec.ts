import { existsSync, mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runFinalDemoCommand } from "../../src/commands/runFinalDemoCommand.js";

const tempDirs: string[] = [];
afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("runFinalDemoCommand", () => {
  it("runs the full fake final demo", async () => {
    const outDir = mkdtempSync(path.join(os.tmpdir(), "final-demo-command-"));
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
    expect(existsSync(path.join(outDir, "controlled-experiment", "experiment-summary.json"))).toBe(true);
    expect(existsSync(path.join(outDir, "experiment-report", "experiment-report.html"))).toBe(true);
    expect(existsSync(path.join(outDir, "plots", "plot-data.json"))).toBe(true);
    expect(existsSync(path.join(outDir, "visualization-demos", "visualization-demo-summary.json"))).toBe(true);
    expect(existsSync(path.join(outDir, "gallery", "gallery-manifest.json"))).toBe(true);
  }, 15000);
});
