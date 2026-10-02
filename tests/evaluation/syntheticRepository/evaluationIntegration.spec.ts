import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { validateAnswerKey } from "../../../src/evaluation/benchmarkMetadata.js";
import { buildMyDevKitIndex } from "../../../src/evaluation/runMyDevKitRetrieval.js";
import { runRawFullFileBaseline } from "../../../src/evaluation/runRawFullFileBaseline.js";
import { scoreCorrectness } from "../../../src/evaluation/scoreCorrectness.js";
import type { MyDevKitIndexTarget } from "../../../src/evaluation/types.js";
import { materializeSyntheticRepository, planSyntheticRepositoryCase } from "../../../src/evaluation/syntheticRepository/index.js";
import type { SyntheticRepositoryCaseSpecV1 } from "../../../src/evaluation/syntheticRepository/index.js";
import { makeCase } from "./planOracle.js";
import { makeTempRoot, removeTempRoot } from "./repositoryInspector.js";

let root: string;
beforeEach(() => {
  root = makeTempRoot();
});
afterEach(() => {
  removeTempRoot(root);
});

function materialize(overrides: Partial<SyntheticRepositoryCaseSpecV1>) {
  return materializeSyntheticRepository(planSyntheticRepositoryCase(makeCase({ id: "eval-case", seed: "eval", ...overrides })), root);
}

const SUPPORT = new Set(["package.json", "tsconfig.json", "pyproject.toml"]);

describe("synthetic EvaluationCase integration boundary", () => {
  it("builds the existing EvaluationCase in memory with logical and physical roots separated", () => {
    const result = materialize({ language: "typescript", taskLocality: "cross-module", sourceFileCount: 6, moduleDepth: 3, internalImportCount: 6, symbolCount: 12 });
    const evaluationCase = result.evaluationCase;
    expect(evaluationCase.id).toBe(result.plan.task.taskId);
    expect(evaluationCase.benchmarkProject).toBe(result.plan.logicalProjectId);
    expect(evaluationCase.targetRoot).toBe("synthetic/eval-case/repository");
    expect(evaluationCase.targetRoot).not.toContain(root);
    expect(evaluationCase.absoluteTargetRoot).toBe(result.repositoryRoot);
    expect(statSync(evaluationCase.absoluteTargetRoot).isDirectory()).toBe(true);
    expect(evaluationCase.sourceRoots).toEqual(["src", "tests"]);
    expect(evaluationCase.rawIncludeGlobs).toEqual(["src/**/*.ts", "tests/**/*"]);
    expect(evaluationCase.expectedFiles).toEqual(result.plan.answerKey.expectedFiles);
    expect(evaluationCase.expectedSymbols).toEqual(result.plan.answerKey.expectedSymbols);
    expect(evaluationCase.answerKey?.expectedFiles).toEqual(evaluationCase.expectedFiles);
    expect(evaluationCase.answerKey?.expectedSymbols).toEqual(evaluationCase.expectedSymbols);
    expect(evaluationCase.taskLocality).toBe("cross-module");
    expect(evaluationCase.query.length).toBeGreaterThan(0);
    expect(evaluationCase.title).toBe("Synthetic cross-module task for eval-case");
    expect(result.manifest.task.expectedFactIds).toEqual(evaluationCase.answerKey?.expectedFacts.map((fact) => fact.id));
    expect(result.manifest.rawIncludeGlobs).toEqual(evaluationCase.rawIncludeGlobs);
  });

  for (const language of ["typescript", "python"] as const) {
    for (const taskLocality of ["localized", "cross-module", "broad-change"] as const) {
      it(`${language}/${taskLocality}: raw full-file baseline finds the generated files and the answer key validates and scores`, async () => {
        const result = materialize({ language, taskLocality, sourceFileCount: 8, moduleDepth: 3, internalImportCount: 9, symbolCount: 16, testFileCount: 4 });
        const evaluationCase = result.evaluationCase;
        expect(validateAnswerKey(evaluationCase.answerKey, "synthetic")).toEqual([]);

        const baseline = await runRawFullFileBaseline(evaluationCase);
        const nonSupport = result.manifest.files.filter((file) => file.role !== "support");
        expect([...baseline.filesIncluded].sort()).toEqual(nonSupport.map((file) => file.path).sort());
        for (const expected of evaluationCase.expectedFiles) expect(baseline.filesIncluded).toContain(expected);
        expect(baseline.filesIncluded.some((file) => SUPPORT.has(file))).toBe(false);
        expect(baseline.totalFiles).toBe(nonSupport.length);
        // The baseline adds per-file headers and separators, so it is a different metric from the manifest estimate.
        const contentChars = nonSupport.reduce((total, file) => total + file.charCount, 0);
        expect(baseline.totalChars).toBeGreaterThan(contentChars);
        const again = await runRawFullFileBaseline(evaluationCase);
        expect(again.contextText).toBe(baseline.contextText);
        expect(again.totalEstimatedTokens).toBe(baseline.totalEstimatedTokens);

        const key = evaluationCase.answerKey!;
        const answer = (overrides: { files: string[]; symbols: string[]; facts: string[] }) =>
          scoreCorrectness({
            caseId: evaluationCase.id,
            answerKey: key,
            parsedAnswer: {
              answerText: "",
              relevantFiles: overrides.files,
              relevantSymbols: overrides.symbols,
              expectedFactsFound: overrides.facts,
              commandsRun: [],
              selectedContext: [],
              fullFileReads: [],
              fullFileReadJustifications: [],
              parseStatus: "parsed",
              warnings: [],
            },
          });
        const perfect = answer({ files: key.expectedFiles, symbols: key.expectedSymbols, facts: key.expectedFacts.map((fact) => fact.id) });
        expect(perfect.passed).toBe(true);
        expect(perfect.correctnessScore).toBe(1);
        expect(answer({ files: [], symbols: [], facts: [] }).passed).toBe(false);
      });
    }
  }

  it("builds a baseline for a zero-test repository because the tests glob is omitted", async () => {
    const result = materialize({ language: "python", sourceFileCount: 5, moduleDepth: 2, internalImportCount: 4, symbolCount: 8, testFileCount: 0 });
    expect(result.evaluationCase.sourceRoots).toEqual(["src"]);
    expect(result.evaluationCase.rawIncludeGlobs).toEqual(["src/**/*.py"]);
    const baseline = await runRawFullFileBaseline(result.evaluationCase);
    expect(baseline.totalFiles).toBe(5);
  });

  it("matches the my-dev-kit index target shape: existing root and existing source roots", async () => {
    const result = materialize({ language: "typescript", sourceFileCount: 5, moduleDepth: 2, internalImportCount: 4, symbolCount: 8, testFileCount: 2 });
    const target: MyDevKitIndexTarget = result.evaluationCase;
    const work = path.join(root, "kit-work");
    mkdirSync(work, { recursive: true });
    const stub = path.join(work, "stub-kit.cjs");
    const record = path.join(work, "argv.json");
    writeFileSync(
      stub,
      [
        'const fs = require("node:fs");',
        'const path = require("node:path");',
        "const args = process.argv.slice(2);",
        `fs.writeFileSync(${JSON.stringify(record)}, JSON.stringify(args));`,
        'const projectRoot = args[args.indexOf("--root") + 1];',
        'const sources = args.flatMap((arg, index) => (arg === "--src" ? [args[index + 1]] : []));',
        "if (!fs.statSync(projectRoot).isDirectory()) process.exit(3);",
        "for (const source of sources) if (!fs.statSync(path.join(projectRoot, source)).isDirectory()) process.exit(4);",
        "console.log(JSON.stringify({ ok: true }));",
      ].join("\n")
    );
    const built = await buildMyDevKitIndex({
      target,
      kitCommand: `"${process.execPath}" "${stub}"`,
      indexDir: path.join(work, "index"),
      commandsDir: path.join(work, "commands"),
      requireKit: true,
    });
    expect(built.ok).toBe(true);
    const argv = JSON.parse(readFileSync(record, "utf8")) as string[];
    expect(argv.slice(0, 2)).toEqual(["index", "--root"]);
    expect(argv[2]).toBe(result.repositoryRoot);
    expect(argv.filter((_, index) => argv[index - 1] === "--src")).toEqual(["src", "tests"]);
  });
});
