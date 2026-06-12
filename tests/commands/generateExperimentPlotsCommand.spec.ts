import { existsSync, mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runGenerateExperimentPlotsCommand } from "../../src/commands/generateExperimentPlotsCommand.js";
import { createFakeExperimentFixture } from "../report/experimentReportTestHelpers.js";

const tempDirs: string[] = [];
afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("generateExperimentPlotsCommand", () => {
  it("writes plot artifacts from fake experiment artifacts", async () => {
    const experimentDir = await createFakeExperimentFixture();
    const outDir = mkdtempSync(path.join(os.tmpdir(), "plots-command-"));
    tempDirs.push(experimentDir, outDir);
    expect(await runGenerateExperimentPlotsCommand(["--experiment", experimentDir, "--out", outDir])).toBe(0);
    expect(existsSync(path.join(outDir, "plot-data.json"))).toBe(true);
    expect(existsSync(path.join(outDir, "charts", "token-savings-vs-prompt-length.svg"))).toBe(true);
  });
});
