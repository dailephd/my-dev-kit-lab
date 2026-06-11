import { existsSync, mkdtempSync } from "node:fs";
import { readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readBenchmarkProjectProfiles, readEvaluationCases } from "../../src/evaluation/index.js";
import { generatePromptVariants, writePromptArtifacts } from "../../src/prompts/index.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function buildVariants() {
  const profiles = await readBenchmarkProjectProfiles(path.join(process.cwd(), "benchmarks/contracts/benchmark-project-profiles.json"));
  const cases = await readEvaluationCases(path.join(process.cwd(), "examples/token-savings-cases.json"), process.cwd(), {
    projectProfiles: profiles,
    requireProjectProfileRef: true
  });
  return generatePromptVariants({
    cases: cases.slice(0, 1),
    projectProfiles: profiles,
    strategies: ["raw-full-file"],
    complexityLevels: ["short"]
  });
}

describe("writePromptArtifacts", () => {
  it("writes summary, variants, and deterministic prompt text files", async () => {
    const outDir = mkdtempSync(path.join(os.tmpdir(), "prompt-artifacts-"));
    tempDirs.push(outDir);
    const variants = await buildVariants();
    const summary = await writePromptArtifacts({ outDir, variants });
    expect(summary.promptCount).toBe(1);
    expect(summary.outputPaths.promptFiles).toEqual(["prompts/todo-ts-create-task.raw-full-file.short.txt"]);
    expect(existsSync(path.join(outDir, "prompt-variants-summary.json"))).toBe(true);
    expect(existsSync(path.join(outDir, "prompt-variants.json"))).toBe(true);
    expect(existsSync(path.join(outDir, "prompts", "todo-ts-create-task.raw-full-file.short.txt"))).toBe(true);
    const promptText = await readFile(path.join(outDir, "prompts", "todo-ts-create-task.raw-full-file.short.txt"), "utf8");
    expect(promptText).toContain("Raw Full-File Benchmark Prompt");
  });

  it("does not write prompt files outside the output directory", async () => {
    const outDir = mkdtempSync(path.join(os.tmpdir(), "prompt-artifacts-"));
    tempDirs.push(outDir);
    const variants = await buildVariants();
    variants[0] = { ...variants[0], caseId: "../escape", id: "../escape.raw-full-file.short" };
    const summary = await writePromptArtifacts({ outDir, variants });
    expect(summary.outputPaths.promptFiles[0]).toBe("prompts/..-escape.raw-full-file.short.txt");
    expect(existsSync(path.join(outDir, "prompts", "..-escape.raw-full-file.short.txt"))).toBe(true);
  });
});
