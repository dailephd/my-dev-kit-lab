import { mkdtempSync, existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readEvaluationCases } from "../../src/evaluation/readEvaluationCases.js";
import { runRawFullFileBaseline } from "../../src/evaluation/runRawFullFileBaseline.js";
import { runEvaluateTokenSavingsCommand } from "../../src/commands/evaluateTokenSavings.js";

const tempDirs: string[] = [];
afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("token savings integration", () => {
  it("runs raw baseline on todo-ts", async () => {
    const cases = await readEvaluationCases(path.resolve(process.cwd(), "examples/token-savings-cases.json"), process.cwd());
    const result = await runRawFullFileBaseline(cases[0]);
    expect(result.totalFiles).toBeGreaterThan(0);
    expect(result.totalEstimatedTokens).toBeGreaterThan(0);
  });

  it("runs full token-savings evaluation on one tiny case using fake my-dev-kit", async () => {
    const outDir = mkdtempSync(path.join(os.tmpdir(), "token-integration-"));
    tempDirs.push(outDir);
    const code = await runEvaluateTokenSavingsCommand([
      "--cases",
      path.resolve(process.cwd(), "examples/token-savings-cases.json"),
      "--kit-command",
      `node ${path.resolve(process.cwd(), "tests/fixtures/fake-my-dev-kit-cli.js")}`,
      "--out",
      outDir,
      "--no-screenshot"
    ]);
    expect(code).toBe(0);
    expect(existsSync(path.join(outDir, "token-savings-summary.json"))).toBe(true);
    expect(existsSync(path.join(outDir, "token-savings-runs.json"))).toBe(true);
    expect(existsSync(path.join(outDir, "token-savings-report.html"))).toBe(true);
    expect(existsSync(path.join(outDir, "commands"))).toBe(true);
  }, 15000);
});
