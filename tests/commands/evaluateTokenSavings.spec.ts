import { mkdtempSync, writeFileSync } from "node:fs";
import { access, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runEvaluateTokenSavingsCommand } from "../../src/commands/evaluateTokenSavings.js";

const tempDirs: string[] = [];
afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("runEvaluateTokenSavingsCommand", () => {
  it("runs with example cases and fake my-dev-kit command", async () => {
    const outDir = mkdtempSync(path.join(os.tmpdir(), "eval-command-"));
    tempDirs.push(outDir);
    const code = await runEvaluateTokenSavingsCommand([
      "--cases",
      "examples/token-savings-cases.json",
      "--kit-command",
      `node ${path.resolve(process.cwd(), "tests/fixtures/fake-my-dev-kit-cli.js")}`,
      "--out",
      outDir,
      "--no-screenshot"
    ]);
    expect(code).toBe(0);
    await expect(access(path.join(outDir, "token-savings-summary.json"))).resolves.toBeUndefined();
    await expect(access(path.join(outDir, "token-savings-runs.json"))).resolves.toBeUndefined();
    await expect(access(path.join(outDir, "token-savings-report.html"))).resolves.toBeUndefined();
  }, 15000);

  it("writes PNG or screenshot warning", async () => {
    const outDir = mkdtempSync(path.join(os.tmpdir(), "eval-command-"));
    tempDirs.push(outDir);
    const code = await runEvaluateTokenSavingsCommand([
      "--cases",
      "examples/token-savings-cases.json",
      "--kit-command",
      `node ${path.resolve(process.cwd(), "tests/fixtures/fake-my-dev-kit-cli.js")}`,
      "--out",
      outDir
    ]);
    expect(code).toBe(0);
    const summary = JSON.parse(await readFile(path.join(outDir, "token-savings-summary.json"), "utf8")) as { warnings: string[]; screenshot: { status: string } };
    expect(["captured", "skipped", "failed"]).toContain(summary.screenshot.status);
  }, 15000);

  it("supports --require-kit", async () => {
    const outDir = mkdtempSync(path.join(os.tmpdir(), "eval-command-"));
    tempDirs.push(outDir);
    const code = await runEvaluateTokenSavingsCommand([
      "--cases",
      "examples/token-savings-cases.json",
      "--kit-command",
      `node ${path.resolve(process.cwd(), "tests/fixtures/fake-my-dev-kit-cli.js")}`,
      "--out",
      outDir,
      "--require-kit",
      "--no-screenshot"
    ]);
    expect(code).toBe(0);
  }, 15000);

  it("fails clearly for missing or invalid case files", async () => {
    const outDir = mkdtempSync(path.join(os.tmpdir(), "eval-command-"));
    tempDirs.push(outDir);
    expect(await runEvaluateTokenSavingsCommand(["--cases", "missing.json", "--kit-command", "node fake.js", "--out", outDir])).toBe(1);
    const invalidPath = path.join(outDir, "invalid.json");
    writeFileSync(invalidPath, "{ invalid");
    expect(await runEvaluateTokenSavingsCommand(["--cases", invalidPath, "--kit-command", "node fake.js", "--out", outDir])).toBe(1);
  });
});
