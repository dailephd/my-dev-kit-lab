import path from "node:path";
import { validateAnswerKey } from "../../../evaluation/benchmarkMetadata.js";
import type { BenchmarkProjectProfile, EvaluationCaseInput } from "../../../evaluation/types.js";
import { validateMutationFile } from "./scenarioMutation.js";
import {
  FROZEN_INCREMENTAL_CHANGE_STALENESS_SCENARIO_IDS,
  INCREMENTAL_CHANGE_STALENESS_ANSWER_POLICIES,
  INCREMENTAL_CHANGE_STALENESS_SCENARIO_CATEGORIES,
  INCREMENTAL_CHANGE_STALENESS_SCENARIO_SCHEMA_VERSION,
  type IncrementalChangeStalenessScenario,
  type IncrementalChangeStalenessScenarioCatalog
} from "./scenarioTypes.js";

/** Category each frozen production scenario id is required to declare. */
export const FROZEN_SCENARIO_CATEGORY_BY_ID: Record<(typeof FROZEN_INCREMENTAL_CHANGE_STALENESS_SCENARIO_IDS)[number], string> = {
  U1: "unrelated-file-change",
  L2: "local-implementation-change",
  E1: "exported-symbol-change",
  P1: "public-api-change",
  I1: "import-graph-change",
  T1: "test-only-change"
};

/** Substrings that must never appear in scenario notes/query text (Section 7/9/22.I). */
const FORBIDDEN_TEXT_PATTERNS = [/partial-refresh/i, /changed-files-refresh/i, /affected-neighborhood-refresh/i, /graph-diff/i];

export type ScenarioCatalogValidationOptions = {
  /** When true, requires the catalog to contain exactly the six frozen production scenarios. */
  requireFrozenProductionScenarios?: boolean;
};

/**
 * Strictly validates a parsed incremental-change-staleness scenario catalog.
 * Performs schema/vocabulary checks, benchmark project/case reference checks,
 * answer-policy completeness checks, forbidden-content checks, and full
 * in-memory mutation validation (pre-hash, ordered exact-preimage
 * replacement, post-hash) against the real canonical benchmark files. Never
 * writes to disk.
 */
export async function validateIncrementalChangeStalenessCatalog(
  catalog: unknown,
  profiles: BenchmarkProjectProfile[],
  cases: EvaluationCaseInput[],
  repoRoot: string,
  options: ScenarioCatalogValidationOptions = {}
): Promise<string[]> {
  const errors: string[] = [];

  if (!catalog || typeof catalog !== "object") {
    return ["Scenario catalog must be an object."];
  }
  const candidate = catalog as Partial<IncrementalChangeStalenessScenarioCatalog>;

  if (candidate.schemaVersion !== INCREMENTAL_CHANGE_STALENESS_SCENARIO_SCHEMA_VERSION) {
    errors.push(`schemaVersion must be ${INCREMENTAL_CHANGE_STALENESS_SCENARIO_SCHEMA_VERSION}; received ${JSON.stringify(candidate.schemaVersion)}.`);
  }
  if (!Array.isArray(candidate.scenarios)) {
    errors.push("scenarios must be an array.");
    return errors;
  }

  const profilesById = new Map(profiles.map((profile) => [profile.projectId, profile]));
  const casesById = new Map(cases.map((benchmarkCase) => [benchmarkCase.id, benchmarkCase]));

  const seenIds = new Set<string>();
  for (const [index, scenario] of candidate.scenarios.entries()) {
    errors.push(...(await validateOneScenario(scenario, index, profilesById, casesById, repoRoot, seenIds)));
  }

  if (options.requireFrozenProductionScenarios === true) {
    const actualIds = candidate.scenarios
      .map((scenario) => (scenario && typeof scenario === "object" ? (scenario as { id?: unknown }).id : undefined))
      .filter((id): id is string => typeof id === "string");
    const expected = FROZEN_INCREMENTAL_CHANGE_STALENESS_SCENARIO_IDS;
    const actualSet = new Set(actualIds);
    const missing = expected.filter((id) => !actualSet.has(id));
    const extra = actualIds.filter((id) => !(expected as readonly string[]).includes(id));
    if (missing.length > 0) {
      errors.push(`Production catalog is missing required frozen scenario(s): ${missing.join(", ")}.`);
    }
    if (extra.length > 0) {
      errors.push(`Production catalog contains unexpected scenario id(s) beyond the six frozen scenarios: ${extra.join(", ")}.`);
    }
    if (actualIds.length !== expected.length || missing.length > 0 || extra.length > 0) {
      errors.push(`Production catalog must contain exactly the six frozen scenarios ${expected.join(", ")}; received ${actualIds.join(", ") || "<none>"}.`);
    }
  }

  return errors;
}

async function validateOneScenario(
  scenario: unknown,
  index: number,
  profilesById: Map<string, BenchmarkProjectProfile>,
  casesById: Map<string, EvaluationCaseInput>,
  repoRoot: string,
  seenIds: Set<string>
): Promise<string[]> {
  const errors: string[] = [];
  if (!scenario || typeof scenario !== "object") {
    return [`scenario at index ${index}: must be an object.`];
  }
  const candidate = scenario as Partial<IncrementalChangeStalenessScenario>;
  const id = typeof candidate.id === "string" && candidate.id.length > 0 ? candidate.id : undefined;
  const label = id === undefined ? `scenario at index ${index}` : `scenario ${id}`;

  if (id === undefined) {
    errors.push(`${label}: id must be a nonempty string.`);
  } else if (seenIds.has(id)) {
    errors.push(`${label}: duplicate scenario id.`);
  } else {
    seenIds.add(id);
  }

  if (typeof candidate.category !== "string" || !(INCREMENTAL_CHANGE_STALENESS_SCENARIO_CATEGORIES as readonly string[]).includes(candidate.category)) {
    errors.push(`${label}: category must be one of ${INCREMENTAL_CHANGE_STALENESS_SCENARIO_CATEGORIES.join(", ")}; received ${JSON.stringify(candidate.category)}.`);
  } else if (id !== undefined && id in FROZEN_SCENARIO_CATEGORY_BY_ID) {
    const expectedCategory = FROZEN_SCENARIO_CATEGORY_BY_ID[id as keyof typeof FROZEN_SCENARIO_CATEGORY_BY_ID];
    if (candidate.category !== expectedCategory) {
      errors.push(`${label}: category must be ${expectedCategory} for frozen scenario ${id}; received ${candidate.category}.`);
    }
  }

  if (typeof candidate.answerPolicy !== "string" || !(INCREMENTAL_CHANGE_STALENESS_ANSWER_POLICIES as readonly string[]).includes(candidate.answerPolicy)) {
    errors.push(`${label}: answerPolicy must be one of ${INCREMENTAL_CHANGE_STALENESS_ANSWER_POLICIES.join(", ")}; received ${JSON.stringify(candidate.answerPolicy)}.`);
  }

  const projectId = typeof candidate.benchmarkProjectId === "string" && candidate.benchmarkProjectId.length > 0 ? candidate.benchmarkProjectId : undefined;
  if (projectId === undefined) {
    errors.push(`${label}: benchmarkProjectId must be a nonempty string.`);
  }
  const profile = projectId === undefined ? undefined : profilesById.get(projectId);
  if (projectId !== undefined && profile === undefined) {
    errors.push(`${label}: unknown benchmarkProjectId ${projectId}.`);
  }

  const caseId = typeof candidate.baseCaseId === "string" && candidate.baseCaseId.length > 0 ? candidate.baseCaseId : undefined;
  if (caseId === undefined) {
    errors.push(`${label}: baseCaseId must be a nonempty string.`);
  }
  const baseCase = caseId === undefined ? undefined : casesById.get(caseId);
  if (caseId !== undefined && baseCase === undefined) {
    errors.push(`${label}: unknown baseCaseId ${caseId}.`);
  }
  if (baseCase !== undefined && projectId !== undefined && baseCase.benchmarkProject !== projectId) {
    errors.push(`${label}: baseCaseId ${caseId} belongs to benchmark project ${baseCase.benchmarkProject}, not the referenced benchmarkProjectId ${projectId}.`);
  }

  // Answer-policy completeness (Section 22.H). Reuses the existing answer-key structure/validator.
  if (candidate.answerPolicy === "inherit") {
    if (baseCase !== undefined) {
      if (typeof baseCase.query !== "string" || baseCase.query.length === 0) {
        errors.push(`${label}: inherit policy requires the base case to have a nonempty query.`);
      }
      if (baseCase.answerKey === undefined) {
        errors.push(`${label}: inherit policy requires the base case to have an answerKey.`);
      } else {
        errors.push(...validateAnswerKey(baseCase.answerKey, `${label} (inherited answerKey)`).map((message) => message));
      }
    }
    if (candidate.scenarioQuery !== undefined || candidate.scenarioAnswerKey !== undefined) {
      errors.push(`${label}: inherit policy must not declare scenarioQuery or scenarioAnswerKey.`);
    }
  } else if (candidate.answerPolicy === "scenario") {
    if (typeof candidate.scenarioQuery !== "string" || candidate.scenarioQuery.trim().length === 0) {
      errors.push(`${label}: scenario policy requires a nonempty scenarioQuery.`);
    }
    if (candidate.scenarioAnswerKey === undefined) {
      errors.push(`${label}: scenario policy requires a scenarioAnswerKey.`);
    } else {
      errors.push(...validateAnswerKey(candidate.scenarioAnswerKey, `${label}.scenarioAnswerKey`));
    }
  }

  if (candidate.expectedRelationship !== undefined && !["related", "unrelated", "unknown"].includes(candidate.expectedRelationship)) {
    errors.push(`${label}: expectedRelationship must be one of related, unrelated, unknown; received ${JSON.stringify(candidate.expectedRelationship)}.`);
  }

  for (const text of [candidate.notes, candidate.scenarioQuery, candidate.id, candidate.category]) {
    if (typeof text === "string") {
      for (const pattern of FORBIDDEN_TEXT_PATTERNS) {
        if (pattern.test(text)) {
          errors.push(`${label}: forbidden v0.6.3+/graph-diff reference found in scenario text: matched ${pattern}.`);
        }
      }
    }
  }

  if (!candidate.mutation || typeof candidate.mutation !== "object" || !Array.isArray(candidate.mutation.files) || candidate.mutation.files.length === 0) {
    errors.push(`${label}: mutation.files must be a nonempty array.`);
    return errors;
  }

  if (profile !== undefined && baseCase !== undefined) {
    const projectAbsoluteRoot = path.resolve(repoRoot, profile.rootPath);
    const caseSourceRoots = Array.isArray(baseCase.sourceRoots) ? baseCase.sourceRoots : [];
    for (const [fileIndex, file] of candidate.mutation.files.entries()) {
      const fileLabel = `${label}.mutation.files[${fileIndex}]`;
      const result = await validateMutationFile(fileLabel, file, projectAbsoluteRoot, caseSourceRoots);
      errors.push(...result.errors);
    }
  } else {
    errors.push(`${label}: mutation files cannot be validated because the benchmark project/case reference is invalid.`);
  }

  return errors;
}
