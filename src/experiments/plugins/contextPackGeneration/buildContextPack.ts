import { countEstimatedTokens, countTextChars, tokenCountMethod } from "../../../core/countTokens.js";
import { compareCodeUnits } from "../../../evaluation/indexSnapshot.js";
import type { TaskLocality } from "../../../evaluation/types.js";
import {
  buildContextPackSelectionPolicy,
  selectCallRelationships,
  selectRelevantFiles,
  selectRelevantSymbols,
  selectSourceSlices,
  selectTestFiles,
  type ContextPackCallCandidate,
  type ContextPackFileCandidate,
  type ContextPackSourceSliceCandidate,
  type ContextPackSymbolCandidate,
  type ContextPackTestCandidate
} from "./packSelectionPolicy.js";
import { renderContextPack } from "./renderContextPack.js";
import {
  CONTEXT_PACK_SCHEMA_VERSION,
  CONTEXT_PACK_SECTION_IDS,
  type ContextPack,
  type ContextPackAvailability,
  type ContextPackEvidenceNoteCode,
  type ContextPackSectionAvailabilityInput,
  type ContextPackSectionId,
  type ContextPackTask
} from "./types.js";

export type BuildContextPackInput = {
  caseId: string;
  benchmarkProject: string;
  taskLocality: TaskLocality | null;
  task: ContextPackTask;
  myDevKitVersion: string;
  fileCandidates: readonly ContextPackFileCandidate[];
  symbolCandidates: readonly ContextPackSymbolCandidate[];
  sourceSliceCandidates: readonly ContextPackSourceSliceCandidate[];
  callCandidates: readonly ContextPackCallCandidate[];
  testCandidates: readonly ContextPackTestCandidate[];
  /** Notes the caller already knows about; merged with the notes the pure selection produces. */
  evidenceNotes?: readonly ContextPackEvidenceNoteCode[];
  /**
   * Explicit availability from the caller. The task section is always available and is not part of this input; absence
   * of items is never converted into unavailability here.
   */
  sectionAvailability: Record<Exclude<ContextPackSectionId, "task">, ContextPackSectionAvailabilityInput>;
  availability: ContextPackAvailability;
  reason: string | null;
};

/**
 * Pure context-pack composition. No filesystem, process, environment, network, clock or randomness: identical input
 * yields structurally identical output. It selects within the frozen caps, renders deterministically, and measures size
 * from the exact rendered text.
 */
export function buildContextPack(input: BuildContextPackInput): ContextPack {
  const files = selectRelevantFiles(input.fileCandidates);
  const symbols = selectRelevantSymbols(input.symbolCandidates);
  const sourceSlices = selectSourceSlices(input.sourceSliceCandidates);
  const calls = selectCallRelationships(input.callCandidates);
  const tests = selectTestFiles(input.testCandidates);
  const evidenceNotes = [
    ...new Set<ContextPackEvidenceNoteCode>([
      ...(input.evidenceNotes ?? []),
      ...files.notes,
      ...symbols.notes,
      ...sourceSlices.notes,
      ...calls.notes,
      ...tests.notes
    ])
  ].sort(compareCodeUnits);

  const sectionAvailability: Record<ContextPackSectionId, ContextPackSectionAvailabilityInput> = {
    task: { availability: "available", reason: null },
    files: { ...input.sectionAvailability.files },
    symbols: { ...input.sectionAvailability.symbols },
    sourceSlices: { ...input.sectionAvailability.sourceSlices },
    callRelationships: { ...input.sectionAvailability.callRelationships },
    tests: { ...input.sectionAvailability.tests },
    evidenceNotes: { ...input.sectionAvailability.evidenceNotes }
  };
  const itemCounts: Record<ContextPackSectionId, number> = {
    task: 1,
    files: files.items.length,
    symbols: symbols.items.length,
    sourceSlices: sourceSlices.items.length,
    callRelationships: calls.items.length,
    tests: tests.items.length,
    evidenceNotes: evidenceNotes.length
  };

  const rendered = renderContextPack({
    task: input.task,
    files: files.items,
    symbols: symbols.items,
    sourceSlices: sourceSlices.items,
    callRelationships: calls.items,
    tests: tests.items,
    evidenceNotes,
    sectionAvailability
  });

  return {
    schemaVersion: CONTEXT_PACK_SCHEMA_VERSION,
    caseId: input.caseId,
    benchmarkProject: input.benchmarkProject,
    taskLocality: input.taskLocality,
    task: { title: input.task.title, summary: input.task.summary },
    selectionPolicy: buildContextPackSelectionPolicy(input.myDevKitVersion),
    files: files.items,
    symbols: symbols.items,
    sourceSlices: sourceSlices.items,
    callRelationships: calls.items,
    tests: tests.items,
    evidenceNotes,
    sections: CONTEXT_PACK_SECTION_IDS.map((id) => ({
      id,
      availability: sectionAvailability[id].availability,
      reason: sectionAvailability[id].reason,
      itemCount: itemCounts[id],
      estimatedTokens: countEstimatedTokens(rendered.sections[id])
    })),
    size: {
      totalChars: countTextChars(rendered.renderedText),
      totalEstimatedTokens: countEstimatedTokens(rendered.renderedText),
      tokenCountMethod
    },
    availability: input.availability,
    reason: input.reason,
    renderedText: rendered.renderedText
  };
}
