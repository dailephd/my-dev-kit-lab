import { existsSync, mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runVisualizationDemosCommand } from "../../src/commands/runVisualizationDemosCommand.js";

const tempDirs: string[] = [];
afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("runVisualizationDemosCommand", () => {
  it("runs with fake my-dev-kit", async () => {
    const outDir = mkdtempSync(path.join(os.tmpdir(), "viz-command-"));
    tempDirs.push(outDir);
    expect(
      await runVisualizationDemosCommand([
        "--project",
        "benchmarks/projects/todo-ts",
        "--kit-command",
        "node tests/fixtures/fake-my-dev-kit-cli.js",
        "--out",
        outDir
      ])
    ).toBe(0);
    expect(existsSync(path.join(outDir, "visualization-demo-summary.json"))).toBe(true);
    expect(existsSync(path.join(outDir, "artifacts", "call-graph.svg"))).toBe(true);
  });
});
