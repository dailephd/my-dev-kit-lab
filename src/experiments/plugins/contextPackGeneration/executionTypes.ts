import type { RetrievalQualityIdentityEvidence } from "../../../evaluation/retrievalQuality/metrics.js";
import type { TaskLocality } from "../../../evaluation/types.js";
import type { ExperimentRunStatus } from "../../types.js";
import type { ContextPackGenerationTreatmentId } from "./metadata.js";
import type {
  ContextPack,
  ContextPackAvailability,
  ContextPackEvidenceNoteCode,
  ContextPackSectionSummary,
  ContextPackSize
} from "./types.js";

/** Bounded case-level failure codes. No external-local, privacy or persistence codes belong here. */
export type ContextPackGenerationErrorCode =
  | "ground-truth-invalid"
  | "project-group-inconsistent"
  | "project-index-failed"
  | "raw-baseline-failed"
  | "retrieval-failed"
  | "pack-construction-failed";

/** Plugin-owned text per code; caught error messages and process stderr are never copied into durable evidence. */
export const CONTEXT_PACK_GENERATION_ERROR_TEXT: Record<ContextPackGenerationErrorCode, string> = {
  "ground-truth-invalid": "The case ground truth was invalid.",
  "project-group-inconsistent": "The case source configuration was inconsistent.",
  "project-index-failed": "The my-dev-kit index could not be prepared.",
  "raw-baseline-failed": "The raw full-file baseline could not be built.",
  "retrieval-failed": "The context-pack retrieval did not complete.",
  "pack-construction-failed": "The context pack could not be constructed."
};

export type ContextPackGenerationErrorV1 = { code: ContextPackGenerationErrorCode; message: string };

/** One executed (or attempted) my-dev-kit step, in execution order. Holds no stdout, stderr, command line or path. */
export type ContextPackExecutionStepV1 = {
  kind: "search" | "lookup" | "slice" | "source";
  nodeId: string | null;
  /** How a source step selected its range; null for other kinds. */
  sourceMode: "index-range" | "node" | null;
  succeeded: boolean;
  /** Fixed-vocabulary reason, present only when the step was not fully successful. */
  reason: string | null;
};

export type ContextPackGenerationTreatmentEvidenceV1 = {
  treatmentId: ContextPackGenerationTreatmentId;
  status: ExperimentRunStatus;
  availability: ContextPackAvailability | null;
  availabilityReason: string | null;
  size: ContextPackSize | null;
  /** Actual file/symbol identities the treatment exposed; the only input to the retrieval-quality calculator. */
  identityEvidence: RetrievalQualityIdentityEvidence | null;
  /** Raw: files included in the baseline. Context pack: files selected for the pack. */
  includedFiles: string[];
  steps: ContextPackExecutionStepV1[];
  /** Context-pack treatment only. */
  sections: ContextPackSectionSummary[] | null;
  evidenceNotes: ContextPackEvidenceNoteCode[];
  /** Relative path of the bundled per-case pack artifact; null when no pack was produced. */
  packArtifactPath: string | null;
  errors: ContextPackGenerationErrorV1[];
};

/** One case with exactly two treatments, in CONTEXT_PACK_GENERATION_TREATMENT_IDS order. */
export type ContextPackGenerationCaseEvidenceV1 = {
  caseId: string;
  caseName: string;
  benchmarkProject: string;
  taskLocality: TaskLocality | null;
  treatments: ContextPackGenerationTreatmentEvidenceV1[];
};

/** In-memory case result. The pack body (source text) never rides on the durable evidence. */
export type ContextPackGenerationCaseResult = {
  evidence: ContextPackGenerationCaseEvidenceV1;
  pack: ContextPack | null;
};
