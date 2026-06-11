import { mkdtempSync, writeFileSync } from "node:fs";
import { access, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runGeneratePromptVariantsCommand } from "../../src/commands/generatePromptVariants.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("runGeneratePromptVariantsCommand", () => {
  it("runs with example cases and writes prompt artifacts", async () => {
    const outDir = mkdtempSync(path.join(os.tmpdir(), "prompt-command-"));
    tempDirs.push(outDir);
    const code = await runGeneratePromptVariantsCommand(["--cases", "examples/token-savings-cases.json", "--out", outDir]);
    expect(code).toBe(0);
    await expect(access(path.join(outDir, "prompt-variants-summary.json"))).resolves.toBeUndefined();
    await expect(access(path.join(outDir, "prompt-variants.json"))).resolves.toBeUndefined();
    const summary = JSON.parse(await readFile(path.join(outDir, "prompt-variants-summary.json"), "utf8")) as { promptCount: number };
    expect(summary.promptCount).toBe(32);
  });

  it("supports strategy and complexity filtering", async () => {
    const outDir = mkdtempSync(path.join(os.tmpdir(), "prompt-command-"));
    tempDirs.push(outDir);
    const code = await runGeneratePromptVariantsCommand([
      "--cases",
      "examples/token-savings-cases.json",
      "--out",
      outDir,
      "--strategy",
      "my-dev-kit-guided",
      "--complexity",
      "multi-step"
    ]);
    expect(code).toBe(0);
    const variants = JSON.parse(await readFile(path.join(outDir, "prompt-variants.json"), "utf8")) as Array<{
      strategy: string;
      complexityLevel: string;
    }>;
    expect(variants).toHaveLength(4);
    expect(variants.every((variant) => variant.strategy === "my-dev-kit-guided")).toBe(true);
    expect(variants.every((variant) => variant.complexityLevel === "multi-step")).toBe(true);
  });

  it("fails clearly for missing or invalid case files", async () => {
    const outDir = mkdtempSync(path.join(os.tmpdir(), "prompt-command-"));
    tempDirs.push(outDir);
    expect(await runGeneratePromptVariantsCommand(["--cases", "missing.json", "--out", outDir])).toBe(1);
    const invalidPath = path.join(outDir, "invalid.json");
    writeFileSync(invalidPath, "{ invalid");
    expect(await runGeneratePromptVariantsCommand(["--cases", invalidPath, "--out", outDir])).toBe(1);
  });
});
