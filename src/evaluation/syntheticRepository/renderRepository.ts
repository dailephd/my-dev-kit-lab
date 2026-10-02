import { inspectRepositoryFiles } from "./inspection.js";
import { renderPythonRepository } from "./renderPython.js";
import { SyntheticRepositoryRenderError } from "./renderShared.js";
import type { RenderedFile } from "./renderShared.js";
import { renderTypeScriptRepository } from "./renderTypeScript.js";
import type { SyntheticRepositoryPlanV1 } from "./types.js";

/**
 * Renders a frozen plan into its complete generated file set (sorted by logical path) and proves the files
 * realize the plan: counts, import edges, patterns and depth are re-measured from the rendered bytes and must
 * equal the plan, otherwise rendering fails closed. No filesystem access.
 */
export function renderSyntheticRepository(plan: SyntheticRepositoryPlanV1): RenderedFile[] {
  const files = plan.language === "typescript" ? renderTypeScriptRepository(plan) : renderPythonRepository(plan);
  const inspection = inspectRepositoryFiles(plan.language, files);
  const errors = [...inspection.issues];
  const expected = {
    sourceFileCount: plan.requested.sourceFileCount,
    moduleDepth: plan.requested.moduleDepth,
    internalImportCount: plan.requested.internalImportCount,
    symbolCount: plan.requested.symbolCount,
    testFileCount: plan.requested.testFileCount,
    repeatedPatternCount: plan.requested.repeatedPatternCount,
  };
  for (const key of Object.keys(expected) as Array<keyof typeof expected>) {
    if (inspection.dimensions[key] !== expected[key]) {
      errors.push(`rendered ${key} ${inspection.dimensions[key]} does not equal planned ${expected[key]}.`);
    }
  }
  const plannedEdges = new Map(plan.modules.map((module) => [module.moduleId, module.path] as const));
  const expectedEdges = plan.importEdges
    .map((edge) => `${plannedEdges.get(edge.from)} -> ${plannedEdges.get(edge.to)}`)
    .sort();
  if (expectedEdges.join("\n") !== inspection.importEdges.join("\n")) errors.push("rendered import edges do not equal the planned import edges.");
  const plannedNames = plan.symbols.map((symbol) => symbol.name).sort();
  if (plannedNames.join("\n") !== [...inspection.symbolNames].sort().join("\n")) errors.push("rendered symbols do not equal the planned symbols.");
  if (errors.length > 0) throw new SyntheticRepositoryRenderError(errors);
  return files;
}
