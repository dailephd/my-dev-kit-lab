import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { tokenCountMethod } from "../core/countTokens.js";
import { resolveWithinRoot } from "../core/pathSafety.js";
import type { PromptArtifactSummary, PromptComplexityLevel, PromptStrategy, PromptVariant } from "./types.js";

export async function writePromptArtifacts(args: {
  outDir: string;
  variants: PromptVariant[];
  generatedAt?: string;
}): Promise<PromptArtifactSummary> {
  const outDir = path.resolve(args.outDir);
  const promptDir = resolveWithinRoot(outDir, "prompts");
  await mkdir(promptDir, { recursive: true });

  const promptFiles: string[] = [];
  for (const variant of args.variants) {
    const fileName = promptVariantFileName(variant);
    const fullPath = resolveWithinRoot(promptDir, fileName);
    await writeFile(fullPath, variant.promptText, "utf8");
    promptFiles.push(path.relative(outDir, fullPath).replace(/\\/g, "/"));
  }

  const summary: PromptArtifactSummary = {
    generatedAt: args.generatedAt ?? new Date(0).toISOString(),
    caseCount: new Set(args.variants.map((variant) => variant.caseId)).size,
    promptCount: args.variants.length,
    strategies: unique(args.variants.map((variant) => variant.strategy)),
    complexityLevels: unique(args.variants.map((variant) => variant.complexityLevel)),
    tokenCountMethod,
    outputPaths: {
      summaryPath: "prompt-variants-summary.json",
      variantsPath: "prompt-variants.json",
      promptDirectory: "prompts",
      promptFiles
    },
    warnings: args.variants.flatMap((variant) => variant.warnings)
  };

  await writeFile(resolveWithinRoot(outDir, "prompt-variants.json"), JSON.stringify(args.variants, null, 2), "utf8");
  await writeFile(resolveWithinRoot(outDir, "prompt-variants-summary.json"), JSON.stringify(summary, null, 2), "utf8");
  return summary;
}

export function promptVariantFileName(variant: PromptVariant): string {
  return `${safeSegment(variant.caseId)}.${variant.strategy}.${variant.complexityLevel}.txt`;
}

function safeSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "-");
}

function unique<T extends PromptStrategy | PromptComplexityLevel>(values: T[]): T[] {
  return [...new Set(values)].sort();
}
