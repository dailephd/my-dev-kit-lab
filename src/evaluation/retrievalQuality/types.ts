/**
 * Normalized retrieval-evidence contract (V1).
 *
 * Describes which files and symbols the existing my-dev-kit search -> lookup -> slice -> source
 * lifecycle actually surfaced. It is observation only: it carries no relevance judgement and no
 * score. It deliberately contains no source text, stdout/stderr bodies, or machine-local paths.
 */

/** Retrieval command families in fixed lifecycle order. */
export const RETRIEVAL_COMMAND_FAMILIES = ["search", "lookup", "slice", "source"] as const;

export type RetrievalCommandFamily = (typeof RETRIEVAL_COMMAND_FAMILIES)[number];

/**
 * `available`: every executed command was interpreted and nothing was rejected. An empty file list is a
 * genuine "retrieved nothing" observation.
 * `partial`: search was interpreted but at least one executed command could not be fully interpreted.
 * `unavailable`: no trustworthy retrieval observation exists. This is never an empty successful retrieval.
 */
export type RetrievalEvidenceAvailability = "available" | "partial" | "unavailable";

/**
 * `parsed`: structured JSON output was interpreted against the known upstream contract.
 * `selection-attributed`: source evidence came from trusted lifecycle selection metadata, never from text.
 * `command-failed`: the command failed; its output was not interpreted.
 * `malformed`: the command succeeded but its output was not valid JSON of the expected top-level form.
 * `unsupported-schema`: valid JSON, but not the supported upstream artifact/shape.
 * `unattributable`: source succeeded but the lifecycle selection gave no usable file identity.
 * `duplicate-ignored`: a repeated command family; only the first occurrence is interpreted.
 */
export type RetrievalCommandParseState =
  | "parsed"
  | "selection-attributed"
  | "command-failed"
  | "malformed"
  | "unsupported-schema"
  | "unattributable"
  | "duplicate-ignored";

export type RetrievedFileEvidenceV1 = {
  /** Platform-neutral repository-relative path. */
  path: string;
  /** Command families that explicitly surfaced this file, in lifecycle order. */
  surfacedBy: RetrievalCommandFamily[];
};

export type RetrievedSymbolEvidenceV1 = {
  /** Display name as reported upstream. Not an identity on its own. */
  name: string;
  /** Upstream stable node id; omitted when upstream did not provide one. Never synthesized. */
  nodeId?: string;
  /** Normalized repository-relative file; omitted when upstream did not provide one. */
  file?: string;
  surfacedBy: RetrievalCommandFamily[];
};

export type RetrievalCommandEvidenceV1 = {
  family: RetrievalCommandFamily;
  succeeded: boolean;
  parseState: RetrievalCommandParseState;
  fileEvidenceCount: number;
  symbolEvidenceCount: number;
  /** Count of identities dropped because they were unsafe or malformed. Values are never echoed. */
  rejectedIdentityCount: number;
  /** Bounded fixed-vocabulary reason; present only when interpretation was not fully successful. */
  reason?: string;
};

export type RetrievalEvidenceV1 = {
  schemaVersion: "retrieval-evidence-v1";
  availability: RetrievalEvidenceAvailability;
  /** Bounded fixed-vocabulary reason; present when availability is not `available`. */
  availabilityReason?: string;
  /** Distinct files sorted by path in code-unit order. */
  files: RetrievedFileEvidenceV1[];
  /** Distinct symbols sorted by (file, name, nodeId) in code-unit order. */
  symbols: RetrievedSymbolEvidenceV1[];
  /** One entry per executed family, in search -> lookup -> slice -> source order. */
  commands: RetrievalCommandEvidenceV1[];
};

/** Trusted lifecycle selection metadata used to attribute the source command. */
export type RetrievalEvidenceSelection = {
  /** Node id the lifecycle passed to lookup/slice/source. */
  nodeId?: string;
  /** Repository-relative file of the selected search candidate. */
  file?: string;
};

export type RetrievalEvidenceCommandInput =
  | { family: "search" | "lookup" | "slice"; ok: boolean; stdout: string }
  /** Source output is context text, not evidence: its body is deliberately not part of the input. */
  | { family: "source"; ok: boolean };

export type BuildRetrievalEvidenceInput = {
  commands: readonly RetrievalEvidenceCommandInput[];
  selection?: RetrievalEvidenceSelection;
};
