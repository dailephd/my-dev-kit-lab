import { compareCodeUnits } from "../../../evaluation/indexSnapshot.js";
import type { LocalRepositorySubject } from "../../../evaluation/localRepositorySubject/index.js";
import type { RetrievalQualityMetricsV1 } from "../../../evaluation/retrievalQuality/index.js";
import { LocalSubjectExecutionError } from "../contextWindowScaling/localSubjectErrors.js";
import { redactedFileList } from "../contextWindowScaling/localSubjectPrivacy.js";
import type { ContextPackGenerationAnalysisV1 } from "./analysisTypes.js";
import {
  CONTEXT_PACK_GENERATION_ERROR_TEXT,
  CONTEXT_PACK_IDENTITY_REDACTION_SCHEMA_VERSION,
  type ContextPackGenerationCaseEvidenceV1,
  type ContextPackGenerationCaseResult,
  type ContextPackGenerationTreatmentEvidenceV1,
  type ContextPackIdentityRedactionV1
} from "./executionTypes.js";
import { collectContextPackFileIdentities } from "./localSubjectExecution.js";
import type { ContextPack } from "./types.js";

/** Single fixed placeholder for a withheld case title. */
export const CONTEXT_PACK_REDACTED_CASE_TITLE = "<redacted case title>";

/** The one V1 marker stamped on every externally projected case. Every class it names is absent from durable output. */
export const CONTEXT_PACK_IDENTITY_REDACTION: ContextPackIdentityRedactionV1 = {
  schemaVersion: CONTEXT_PACK_IDENTITY_REDACTION_SCHEMA_VERSION,
  fileIdentities: "redacted",
  symbolIdentities: "redacted",
  sourceText: "redacted",
  callRelationships: "redacted",
  testIdentities: "redacted",
  factIdentities: "redacted",
  taskText: "redacted",
  warningText: "redacted",
  semanticNodeIds: "redacted",
  caseTitle: "redacted"
};

export const CONTEXT_PACK_PRIVACY_FAILURE_MESSAGE =
  "External-local context-pack-generation privacy projection failed; no durable output was written.";

export const CONTEXT_PACK_UNEXPECTED_EXTERNAL_FAILURE_MESSAGE =
  "Local subject context-pack-generation failed (EXECUTION_FAILED): execution failed before completing (details withheld).";

export const CONTEXT_PACK_EXTERNAL_PERSISTENCE_FAILURE_MESSAGE =
  "External-local context-pack-generation artifact persistence failed; attempted files were removed.";

/** Fragments shorter than this (trimmed) are never searched: they collide with ordinary words and fixed text. */
export const CONTEXT_PACK_SOURCE_FRAGMENT_MIN_LENGTH = 8;
/** Upper bound on distinct source fragments retained for the leak assertion. */
export const CONTEXT_PACK_SOURCE_FRAGMENT_MAX_COUNT = 5000;
/** Identity names shorter than this are matched only as whole string values, never as substrings. */
export const CONTEXT_PACK_NAME_SUBSTRING_MIN_LENGTH = 8;

const sectionTruncatedCount = (pack: ContextPack | null, sectionId: string): number | undefined => {
  if (pack === null) return undefined;
  if (sectionId === "sourceSlices") return pack.sourceSlices.filter((slice) => slice.truncated).length;
  return undefined;
};

function projectTreatment(treatment: ContextPackGenerationTreatmentEvidenceV1, pack: ContextPack | null): ContextPackGenerationTreatmentEvidenceV1 {
  return {
    treatmentId: treatment.treatmentId,
    status: treatment.status,
    availability: treatment.availability,
    availabilityReason: treatment.availabilityReason,
    size: treatment.size === null ? null : { ...treatment.size },
    // Identity evidence is the calculator input only; the durable artifact carries counts, never identities.
    identityEvidence: null,
    includedFiles: [],
    identityCounts:
      treatment.identityEvidence === null
        ? null
        : {
            files: treatment.identityEvidence.files.length,
            symbols: treatment.identityEvidence.symbols.length,
            includedFiles: treatment.includedFiles.length
          },
    // Node IDs are semantic identities; kind, outcome and fixed reason survive.
    steps: treatment.steps.map((step) => ({ kind: step.kind, nodeId: null, sourceMode: step.sourceMode, succeeded: step.succeeded, reason: step.reason })),
    sections:
      treatment.sections === null
        ? null
        : treatment.sections.map((section) => {
            const truncatedCount = sectionTruncatedCount(pack, section.id);
            return { ...section, ...(truncatedCount === undefined ? {} : { truncatedCount }) };
          }),
    evidenceNotes: [...treatment.evidenceNotes],
    packArtifactPath: null,
    errors: treatment.errors.map((error) => ({ code: error.code, message: CONTEXT_PACK_GENERATION_ERROR_TEXT[error.code] }))
  };
}

/**
 * Projects identity-bearing execution evidence into privacy-safe durable evidence. It performs no metric calculation and
 * changes no count, size, availability or status. The in-memory pack is read only to count truncated slices.
 */
export function projectContextPackExecutionForExternalLocalPersistence(
  results: readonly ContextPackGenerationCaseResult[]
): ContextPackGenerationCaseEvidenceV1[] {
  return results.map((result) => {
    const evidence = result.evidence;
    return {
      caseId: evidence.caseId,
      caseName: CONTEXT_PACK_REDACTED_CASE_TITLE,
      benchmarkProject: evidence.benchmarkProject,
      taskLocality: evidence.taskLocality,
      treatments: evidence.treatments.map((treatment) => projectTreatment(treatment, treatment.treatmentId === "context-pack" ? result.pack : null)),
      identityRedaction: { ...CONTEXT_PACK_IDENTITY_REDACTION }
    };
  });
}

const placeholders = (kind: "symbol" | "fact", count: number): string[] =>
  Array.from({ length: count }, (_, index) => `<redacted ${kind} ${index + 1}>`);
const filePlaceholders = (list: string[] | null): string[] | null => (list === null ? null : redactedFileList(list.length));
const symbolPlaceholders = (list: string[] | null): string[] | null => (list === null ? null : placeholders("symbol", list.length));
const factPlaceholders = (list: string[] | null): string[] | null => (list === null ? null : placeholders("fact", list.length));

/** Only identity lists change; every number, availability and fixed-vocabulary reason is carried through untouched. */
function projectQuality(quality: RetrievalQualityMetricsV1): RetrievalQualityMetricsV1 {
  return {
    ...quality,
    file: {
      ...quality.file,
      relevantRetrievedFiles: filePlaceholders(quality.file.relevantRetrievedFiles),
      irrelevantRetrievedFiles: filePlaceholders(quality.file.irrelevantRetrievedFiles),
      missedFiles: filePlaceholders(quality.file.missedFiles)
    },
    symbol: {
      ...quality.symbol,
      relevantRetrievedSymbols: symbolPlaceholders(quality.symbol.relevantRetrievedSymbols),
      irrelevantRetrievedSymbols: symbolPlaceholders(quality.symbol.irrelevantRetrievedSymbols),
      missedSymbols: symbolPlaceholders(quality.symbol.missedSymbols)
    },
    fact: {
      ...quality.fact,
      coveredFactIds: factPlaceholders(quality.fact.coveredFactIds),
      uncoveredFactIds: factPlaceholders(quality.fact.uncoveredFactIds)
    }
  };
}

/**
 * Preserves every numeric scientific value; replaces only the private identity lists inside per-treatment quality.
 * F1, deltas, savings, scope means and matched-case membership are never recalculated.
 */
export function projectContextPackAnalysisForExternalLocalPersistence(analysis: ContextPackGenerationAnalysisV1): ContextPackGenerationAnalysisV1 {
  const cloned = structuredClone(analysis);
  return {
    cases: cloned.cases.map((entry) => ({
      ...entry,
      treatments: entry.treatments.map((treatment) => ({
        ...treatment,
        quality: treatment.quality === null ? null : projectQuality(treatment.quality)
      }))
    })),
    scopes: cloned.scopes
  };
}

/** Real values gathered before projection; the assertion searches every durable payload for them. */
export type ContextPackExternalPrivateValues = {
  privateRoots: readonly string[];
  /** Repository-relative file identities, including test files. */
  filePaths: readonly string[];
  symbolNames: readonly string[];
  /** Semantic node IDs and call-edge endpoint IDs. */
  nodeIds: readonly string[];
  /** Case titles, task queries and any other task text. */
  taskTexts: readonly string[];
  factIds: readonly string[];
  warnings: readonly string[];
  /** Real source lines; only fragments of at least CONTEXT_PACK_SOURCE_FRAGMENT_MIN_LENGTH characters are searched. */
  sourceFragments: readonly string[];
};

/** Distinct non-trivial source lines of a pack, in code-unit order and bounded. Never returns short tokens. */
export function collectContextPackSourceFragments(packs: readonly (ContextPack | null)[]): string[] {
  const fragments = new Set<string>();
  for (const pack of packs) {
    if (pack === null) continue;
    for (const slice of pack.sourceSlices) {
      for (const line of slice.text.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (trimmed.length >= CONTEXT_PACK_SOURCE_FRAGMENT_MIN_LENGTH) fragments.add(trimmed);
      }
    }
  }
  return [...fragments].sort(compareCodeUnits).slice(0, CONTEXT_PACK_SOURCE_FRAGMENT_MAX_COUNT);
}

const variantsOf = (value: string): string[] => {
  const forward = value.replace(/\\/g, "/");
  const backward = value.replace(/\//g, "\\");
  return [value, forward, backward].flatMap((entry) => [entry, JSON.stringify(entry).slice(1, -1)]);
};

const baseName = (file: string): string => file.slice(file.lastIndexOf("/") + 1);

/**
 * Fail-closed defense in depth over a complete would-be durable payload. Roots, file paths, node IDs, task text,
 * warnings and non-trivial source fragments are searched as substrings. Symbol names, fact IDs and file base names are
 * searched only when at least CONTEXT_PACK_NAME_SUBSTRING_MIN_LENGTH characters long: shorter names collide with fixed
 * schema vocabulary (for example a symbol called `search`) and would make ordinary repositories unrunnable. The structural
 * projection, not this search, is what removes short identities.
 */
export function assertContextPackExternalProjectionIsPrivate(projected: unknown, privateValues: ContextPackExternalPrivateValues): void {
  const serialized = typeof projected === "string" ? projected : JSON.stringify(projected);
  const substringCandidates = [
    ...privateValues.privateRoots,
    ...privateValues.filePaths,
    ...privateValues.nodeIds,
    ...privateValues.taskTexts,
    ...privateValues.warnings,
    ...privateValues.sourceFragments.filter((fragment) => fragment.trim().length >= CONTEXT_PACK_SOURCE_FRAGMENT_MIN_LENGTH),
    ...[...privateValues.symbolNames, ...privateValues.factIds, ...privateValues.filePaths.map(baseName)].filter(
      (name) => name.length >= CONTEXT_PACK_NAME_SUBSTRING_MIN_LENGTH
    )
  ].filter((value) => value.length > 0);
  if (substringCandidates.some((value) => variantsOf(value).some((variant) => serialized.includes(variant)))) {
    throw new Error(CONTEXT_PACK_PRIVACY_FAILURE_MESSAGE);
  }
}

const GENERIC_ISSUE_TEXT: Record<string, string> = {
  WORK_ROOT_INSIDE_TARGET: "the output directory must be outside the local subject repository",
  BEFORE_SNAPSHOT_FAILED: "the target snapshot before execution could not be captured",
  AFTER_SNAPSHOT_FAILED: "the target snapshot after execution could not be captured",
  SCRATCH_CLEANUP_FAILED: "the private scratch could not be removed",
  GUIDED_EXCLUSION_LIMIT: "the guided-index exclusions exceeded the safe limit",
  GUIDED_EXCLUSION_UNREPRESENTABLE: "the guided-index exclusions could not be expressed exactly"
};

/**
 * Safe, persistable description of an external-local failure: issue codes, counts and mutation kinds only. Execution
 * issue messages are fixed text by construction; nothing else (no path, identity, title, or caught text) can appear.
 */
export function describeContextPackLocalSubjectFailureForPersistence(error: LocalSubjectExecutionError): string {
  const parts: string[] = [];
  const seen = new Set<string>();
  for (const issue of error.issues) {
    if (issue.code === "EXECUTION_FAILED" || issue.code === "GROUND_TRUTH_INVALID" || issue.code === "RETRIEVAL_OUTSIDE_ELIGIBLE_UNIVERSE") {
      if (!seen.has(issue.message)) {
        seen.add(issue.message);
        parts.push(issue.message.replace(/\.$/, ""));
      }
      continue;
    }
    if (seen.has(issue.code)) continue;
    seen.add(issue.code);
    if (issue.code === "TARGET_MUTATED") {
      const kinds = [...new Set((error.immutability?.mutations ?? []).map((mutation) => mutation.kind))].sort();
      parts.push(`the target changed during execution${kinds.length > 0 ? ` (${kinds.join(", ")})` : ""}; it was not restored`);
    } else {
      parts.push(GENERIC_ISSUE_TEXT[issue.code] ?? `issue ${issue.code}`);
    }
  }
  return `Local subject context-pack-generation failed (${error.code}): ${parts.join("; ")}.`;
}

function collectNodeIds(value: unknown, into: Set<string>): void {
  if (Array.isArray(value)) for (const entry of value) collectNodeIds(entry, into);
  else if (value && typeof value === "object") {
    for (const [key, nested] of Object.entries(value)) {
      if ((key === "nodeId" || key === "fromNodeId" || key === "toNodeId") && typeof nested === "string") into.add(nested);
      else collectNodeIds(nested, into);
    }
  }
}

/**
 * Gathers the real private identities of one external-local run, before projection, for the fail-closed assertion.
 * Everything is read from in-memory data already produced; nothing is read from disk or the repository.
 */
export function collectContextPackExternalPrivateValues(args: {
  subject: LocalRepositorySubject;
  results: readonly ContextPackGenerationCaseResult[];
  outputRoot: string;
}): ContextPackExternalPrivateValues {
  const { subject, results } = args;
  const filePaths = new Set<string>([
    ...subject.eligibleFiles,
    ...subject.runtimeSafetyExclusions.gitIgnoredFiles,
    ...subject.runtimeSafetyExclusions.oversizedFiles
  ]);
  const symbolNames = new Set<string>();
  const nodeIds = new Set<string>();
  const taskTexts = new Set<string>();
  const factIds = new Set<string>();
  for (const evaluationCase of subject.evaluationCases) {
    taskTexts.add(evaluationCase.title);
    taskTexts.add(evaluationCase.query);
    for (const name of evaluationCase.expectedSymbols) symbolNames.add(name);
    for (const file of evaluationCase.expectedFiles) filePaths.add(file);
    for (const fact of evaluationCase.answerKey?.expectedFacts ?? evaluationCase.expectedFacts ?? []) factIds.add(fact.id);
  }
  for (const result of results) {
    for (const file of collectContextPackFileIdentities(result)) filePaths.add(file);
    for (const treatment of result.evidence.treatments) {
      for (const symbol of treatment.identityEvidence?.symbols ?? []) symbolNames.add(symbol.name);
      collectNodeIds(treatment.steps, nodeIds);
    }
    if (result.pack !== null) {
      taskTexts.add(result.pack.task.title);
      taskTexts.add(result.pack.task.summary);
      for (const symbol of result.pack.symbols) symbolNames.add(symbol.name);
      for (const slice of result.pack.sourceSlices) {
        if (slice.symbolName !== null) symbolNames.add(slice.symbolName);
      }
      collectNodeIds(result.pack, nodeIds);
    }
  }
  return {
    privateRoots: [subject.repositoryRoot, args.outputRoot],
    filePaths: [...filePaths].sort(compareCodeUnits),
    symbolNames: [...symbolNames].sort(compareCodeUnits),
    nodeIds: [...nodeIds].sort(compareCodeUnits),
    taskTexts: [...taskTexts].sort(compareCodeUnits),
    factIds: [...factIds].sort(compareCodeUnits),
    warnings: [],
    sourceFragments: collectContextPackSourceFragments(results.map((result) => result.pack))
  };
}
