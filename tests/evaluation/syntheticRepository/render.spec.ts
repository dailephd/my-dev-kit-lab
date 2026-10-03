import { execFileSync } from "node:child_process";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import {
  SyntheticRepositoryRenderError,
  planSyntheticRepositoryCase,
  renderPythonRepository,
  renderSyntheticRepository,
  renderTypeScriptRepository,
} from "../../../src/evaluation/syntheticRepository/index.js";
import type { SyntheticRepositoryCaseSpecV1, SyntheticRepositoryPlanV1 } from "../../../src/evaluation/syntheticRepository/index.js";
import { makeCase } from "./planOracle.js";
import { measureRepository } from "./repositoryInspector.js";

const LANGUAGES = ["typescript", "python"] as const;

const CONFIGS: Array<[string, Partial<SyntheticRepositoryCaseSpecV1>]> = [
  ["small", { sourceFileCount: 4, moduleDepth: 2, internalImportCount: 3, symbolCount: 6, testFileCount: 2, repeatedPatternCount: 2 }],
  ["flat", { sourceFileCount: 5, moduleDepth: 1, internalImportCount: 0, symbolCount: 5, testFileCount: 0, repeatedPatternCount: 0 }],
  ["sparse-deep", { sourceFileCount: 12, moduleDepth: 6, internalImportCount: 7, symbolCount: 30, testFileCount: 3, repeatedPatternCount: 5 }],
  ["dense", { sourceFileCount: 7, moduleDepth: 3, internalImportCount: 16, symbolCount: 14, testFileCount: 9, repeatedPatternCount: 11 }],
  ["single", { sourceFileCount: 1, moduleDepth: 1, internalImportCount: 0, symbolCount: 4, testFileCount: 1, repeatedPatternCount: 3 }],
];

function planFor(language: "typescript" | "python", overrides: Partial<SyntheticRepositoryCaseSpecV1>, id = "render-case"): SyntheticRepositoryPlanV1 {
  return planSyntheticRepositoryCase(makeCase({ id, language, seed: "render-seed", taskLocality: "localized", ...overrides }));
}

function pythonAvailable(): boolean {
  try {
    execFileSync("python", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

describe("synthetic repository rendering (pure)", () => {
  for (const language of LANGUAGES) {
    describe(language, () => {
      it("renders the same plan to a byte-identical, identically ordered file set", () => {
        const first = renderSyntheticRepository(planFor(language, CONFIGS[2][1]));
        const second = renderSyntheticRepository(planFor(language, CONFIGS[2][1]));
        expect(second).toEqual(first);
        expect(first.map((file) => file.path)).toEqual([...first.map((file) => file.path)].sort());
        const direct = language === "typescript" ? renderTypeScriptRepository(planFor(language, CONFIGS[2][1])) : renderPythonRepository(planFor(language, CONFIGS[2][1]));
        expect(direct).toEqual(first);
        expect(new Set(first.map((file) => file.path)).size).toBe(first.length);
      });

      it("emits UTF-8 text with LF endings, no BOM and one trailing newline", () => {
        for (const file of renderSyntheticRepository(planFor(language, CONFIGS[0][1]))) {
          expect(file.content, file.path).not.toContain("\r");
          expect(file.content.startsWith("﻿"), file.path).toBe(false);
          expect(file.content.endsWith("\n"), file.path).toBe(true);
          expect(file.content.endsWith("\n\n"), file.path).toBe(false);
          expect(Buffer.from(file.content, "utf8").toString("utf8")).toBe(file.content);
        }
      });

      it("renders exact source, test, symbol, import, depth and pattern dimensions for every configuration", () => {
        for (const [label, overrides] of CONFIGS) {
          const plan = planFor(language, overrides, label);
          const files = renderSyntheticRepository(plan);
          const measured = measureRepository(language, files);
          expect(measured, label).toEqual({
            sourceFileCount: plan.requested.sourceFileCount,
            moduleDepth: plan.requested.moduleDepth,
            internalImportCount: plan.requested.internalImportCount,
            symbolCount: plan.requested.symbolCount,
            testFileCount: plan.requested.testFileCount,
            repeatedPatternCount: plan.requested.repeatedPatternCount,
          });
        }
      });

      it("renders exactly the planned import edges and symbol placement", () => {
        const plan = planFor(language, CONFIGS[3][1]);
        const files = renderSyntheticRepository(plan);
        const byPath = new Map(files.map((file) => [file.path, file.content] as const));
        const pathOf = new Map(plan.modules.map((module) => [module.moduleId, module.path] as const));
        for (const module of plan.modules) {
          const content = byPath.get(module.path) as string;
          const importedFirstSymbols = plan.importEdges
            .filter((edge) => edge.from === module.moduleId)
            .map((edge) => (plan.modules.find((candidate) => candidate.moduleId === edge.to) as { symbolIds: string[] }).symbolIds[0].split("#")[1])
            .sort();
          const importLines = content.split("\n").filter((line) => (language === "typescript" ? line.startsWith("import {") : line.startsWith("from ")));
          expect(importLines.length).toBe(importedFirstSymbols.length);
          for (const name of importedFirstSymbols) expect(importLines.some((line) => line.includes(name))).toBe(true);
          for (const symbolId of module.symbolIds) {
            expect(content).toContain(`${language === "typescript" ? "export function" : "def"} ${symbolId.split("#")[1]}(`);
          }
        }
        expect(pathOf.size).toBe(plan.modules.length);
      });

      it("keeps support files out of every planned domain count", () => {
        const plan = planFor(language, CONFIGS[0][1]);
        const files = renderSyntheticRepository(plan);
        const support = files.filter((file) => file.role === "support").map((file) => file.path);
        expect(support).toEqual(language === "typescript" ? ["package.json", "tsconfig.json"] : ["pyproject.toml"]);
        expect(files.filter((file) => file.role === "source")).toHaveLength(plan.requested.sourceFileCount);
        expect(files.filter((file) => file.role === "test")).toHaveLength(plan.requested.testFileCount);
        expect(files.some((file) => file.path.endsWith("__init__.py"))).toBe(false);
        for (const file of files.filter((candidate) => candidate.role === "support")) {
          expect(file.language).toBeUndefined();
          expect(file.content).not.toContain("sym_");
          expect(file.content).not.toContain("@synthetic-pattern");
        }
        for (const file of files.filter((candidate) => candidate.role !== "support")) expect(file.language).toBe(language);
      });

      it("counts repeated patterns exactly and never from tests or support text", () => {
        for (const repeatedPatternCount of [0, 1, 7]) {
          const plan = planFor(language, { ...CONFIGS[0][1], repeatedPatternCount });
          const files = renderSyntheticRepository(plan);
          const occurrences = files.flatMap((file) => file.content.split("\n").filter((line) => line.includes("@synthetic-pattern ")).map(() => file.path));
          expect(occurrences).toHaveLength(repeatedPatternCount);
          for (const path of occurrences) expect(plan.modules.some((module) => module.path === path)).toBe(true);
          for (const pattern of plan.repeatedPatterns) {
            const module = plan.modules.find((candidate) => candidate.moduleId === pattern.targetModuleId) as { path: string };
            const text = files.find((file) => file.path === module.path)?.content as string;
            expect(text).toContain(`@synthetic-pattern ${pattern.patternId} ordinal=${pattern.ordinal} role=${pattern.role}`);
          }
        }
      });

      it("grounds the task evidence (files, symbols, facts) in rendered content", () => {
        for (const taskLocality of ["localized", "cross-module", "broad-change"] as const) {
          const plan = planFor(language, { sourceFileCount: 8, moduleDepth: 3, internalImportCount: 9, symbolCount: 16, testFileCount: 10, taskLocality });
          const files = renderSyntheticRepository(plan);
          const byPath = new Map(files.map((file) => [file.path, file.content] as const));
          const define = language === "typescript" ? "export function" : "def";
          for (const file of plan.answerKey.expectedFiles) expect(byPath.has(file), file).toBe(true);
          for (const target of plan.answerKey.expectedContextTargets) {
            for (const name of target.symbols) expect(byPath.get(target.file)).toContain(`${define} ${name}(`);
          }
          for (const fact of plan.answerKey.facts) {
            if (fact.role === "symbol-definition") {
              const symbol = plan.symbols.find((candidate) => candidate.symbolId === fact.symbolIds[0]) as { name: string; moduleId: string };
              const module = plan.modules.find((candidate) => candidate.moduleId === symbol.moduleId) as { path: string };
              expect(byPath.get(module.path)).toContain(`${define} ${symbol.name}(`);
            } else if (fact.role === "import-relation") {
              const edge = fact.edge as { from: string; to: string };
              const from = plan.modules.find((candidate) => candidate.moduleId === edge.from) as { path: string };
              const to = plan.modules.find((candidate) => candidate.moduleId === edge.to) as { symbolIds: string[] };
              const imported = to.symbolIds[0].split("#")[1];
              expect(byPath.get(from.path)).toContain(language === "typescript" ? `import { ${imported} } from` : ` import ${imported}\n`);
            } else {
              const test = plan.testFiles.find((candidate) => candidate.testId === fact.testId) as { path: string; targetSymbolIds: string[] };
              expect(byPath.get(test.path)).toContain(test.targetSymbolIds[0].split("#")[1]);
            }
          }
        }
      });

      it("contains no absolute path, drive letter or host data", () => {
        for (const file of renderSyntheticRepository(planFor(language, CONFIGS[2][1]))) {
          expect(file.content, file.path).not.toContain(process.cwd());
          expect(file.content, file.path).not.toMatch(/(^|[^A-Za-z0-9])[A-Za-z]:[\\/]/);
          expect(file.content, file.path).not.toMatch(/(^|\s)\/(home|Users|tmp|var)\//);
          expect(file.content, file.path).not.toContain("\\");
        }
      });
    });
  }

  it("renders syntactically valid TypeScript for every configuration", () => {
    for (const [label, overrides] of CONFIGS) {
      for (const file of renderSyntheticRepository(planFor("typescript", overrides, label)).filter((candidate) => candidate.path.endsWith(".ts"))) {
        const output = ts.transpileModule(file.content, { reportDiagnostics: true, fileName: file.path, compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } });
        expect(output.diagnostics ?? [], `${label}/${file.path}`).toHaveLength(0);
      }
    }
  });

  it.skipIf(!pythonAvailable())("renders syntactically valid Python (ast.parse) for every configuration", () => {
    for (const [label, overrides] of CONFIGS) {
      for (const file of renderSyntheticRepository(planFor("python", overrides, label)).filter((candidate) => candidate.path.endsWith(".py"))) {
        execFileSync("python", ["-c", "import ast,sys; ast.parse(sys.stdin.read())"], { input: file.content, stdio: ["pipe", "ignore", "pipe"] });
      }
    }
  });

  it("fails closed instead of substituting evidence when a plan cannot be faithfully rendered", () => {
    const base = planFor("typescript", CONFIGS[0][1]);
    const escaping = JSON.parse(JSON.stringify(base)) as SyntheticRepositoryPlanV1;
    escaping.modules[0].path = "../escape.ts";
    expect(() => renderSyntheticRepository(escaping)).toThrow(SyntheticRepositoryRenderError);

    const absolute = JSON.parse(JSON.stringify(base)) as SyntheticRepositoryPlanV1;
    absolute.modules[0].path = "/abs/mod.ts";
    expect(() => renderSyntheticRepository(absolute)).toThrow(SyntheticRepositoryRenderError);

    const dangling = JSON.parse(JSON.stringify(base)) as SyntheticRepositoryPlanV1;
    dangling.importEdges[0] = { from: dangling.importEdges[0].from, to: "mod_99999" };
    expect(() => renderSyntheticRepository(dangling)).toThrow(SyntheticRepositoryRenderError);

    const extraPattern = JSON.parse(JSON.stringify(base)) as SyntheticRepositoryPlanV1;
    extraPattern.requested = { ...extraPattern.requested, repeatedPatternCount: extraPattern.requested.repeatedPatternCount + 1 };
    expect(() => renderSyntheticRepository(extraPattern)).toThrow(/repeatedPatternCount/);

    const pythonOutsideSrc = planFor("python", CONFIGS[0][1]);
    pythonOutsideSrc.modules[0].path = "lib/mod_00001.py";
    expect(() => renderSyntheticRepository(pythonOutsideSrc)).toThrow(SyntheticRepositoryRenderError);
  });
});
