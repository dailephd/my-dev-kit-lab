import { mkdtempSync } from "node:fs";
import { access, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { writeTokenSavingsArtifacts } from "../../src/evaluation/writeTokenSavingsArtifacts.js";
import type { TokenSavingsCommandConfig } from "../../src/evaluation/types.js";

const tempDirs: string[] = [];
afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

const config: TokenSavingsCommandConfig = {
  casesPath: "cases.json",
  kitCommand: "node fake.js",
  requireKit: false,
  noScreenshot: false,
  outputDir: "out"
};

describe("writeTokenSavingsArtifacts", () => {
  it("writes summary JSON, runs JSON, HTML report, and records screenshot state", async () => {
    const outDir = mkdtempSync(path.join(os.tmpdir(), "token-artifacts-"));
    tempDirs.push(outDir);
    const result = await writeTokenSavingsArtifacts({
      outDir,
      summary: {
        caseCount: 1,
        completedCaseCount: 1,
        skippedCaseCount: 0,
        averageRawTokens: 10,
        averageMyDevKitTokens: 5,
        averageTokensSaved: 5,
        averagePercentSaved: 50,
        totalRawTokens: 10,
        totalMyDevKitTokens: 5,
        totalTokensSaved: 5,
        totalCommandsRun: 4,
        totalDurationMs: 20,
        tokenCountMethod: "estimated_chars_div_4",
        warnings: []
      },
      runs: [],
      comparisonCases: [],
      commandConfig: config,
      screenshot: { status: "skipped", htmlPath: "x", pngPath: "y", warning: "skip" }
    });
    await expect(access(result.artifactPaths.summaryPath)).resolves.toBeUndefined();
    await expect(access(result.artifactPaths.runsPath)).resolves.toBeUndefined();
    await expect(access(result.artifactPaths.htmlPath)).resolves.toBeUndefined();
    expect(await readFile(result.artifactPaths.summaryPath, "utf8")).toContain("estimated_chars_div_4");
  });
});
