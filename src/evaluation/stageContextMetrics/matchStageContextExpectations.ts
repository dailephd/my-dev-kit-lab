import type { StageContextExpectationFixtureV1 } from "../stageContextExpectations/index.js";
import { buildStageContextExpectationTargetKey } from "./targetKeys.js";
import type { StageContextExpectationMatchOutcome, StageContextExpectationMatchV1, StageContextObservedEvidenceV1 } from "./types.js";

function dedupeStrings(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    if (seen.has(value)) continue;
    seen.add(value);
    result.push(value);
  }
  return result;
}

export function matchStageContextExpectations(
  expectations: StageContextExpectationFixtureV1,
  observedEvidence: readonly StageContextObservedEvidenceV1[]
): StageContextExpectationMatchV1[] {
  return expectations.expectedEvidence.map((item) => {
    const targetKey = buildStageContextExpectationTargetKey(item);
    const observedMatches = observedEvidence.filter(
      (evidence) =>
        evidence.sourceArtifact === item.sourceArtifact && evidence.category === item.category && evidence.targetKey === targetKey
    );

    const matchedSourceInstances = dedupeStrings(observedMatches.map((evidence) => evidence.sourceInstance));
    const matchedSourceFieldPaths = dedupeStrings(observedMatches.map((evidence) => evidence.sourceFieldPath));

    const hasMatch = observedMatches.length > 0;
    let outcome: StageContextExpectationMatchOutcome;
    if (item.inclusion === "forbidden") {
      outcome = hasMatch ? "violated" : "matched";
    } else {
      outcome = hasMatch ? "matched" : "missing";
    }

    return {
      expectationId: item.expectationId,
      inclusion: item.inclusion,
      sourceArtifact: item.sourceArtifact,
      category: item.category,
      targetKey,
      outcome,
      matchedSourceInstances,
      matchedSourceFieldPaths
    };
  });
}
