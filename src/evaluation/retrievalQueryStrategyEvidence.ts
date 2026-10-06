/**
 * Strategy-neutral retrieval identity evidence (V1).
 *
 * Additive to `retrieval-evidence-v1`, which is frozen to the search/lookup/slice/source command
 * families. This contract records only which file and symbol identities a query strategy exposed and
 * which steps ran. It carries no relevance judgement, score, answer-key data, source text,
 * stdout/stderr, or machine-local paths.
 */
import { compareCodeUnits } from "./indexSnapshot.js";
import type { CoreGraphRetrievalQueryStrategyId, RetrievalQueryStrategyId } from "./retrievalQueryStrategies.js";
import type { RetrievalEvidenceV1 } from "./retrievalQuality/types.js";

export type RetrievalQueryStrategyEvidenceAvailability = "available" | "partial" | "unavailable";

export type RetrievalQueryStrategyEvidenceStepKind =
  | "search"
  | "lookup"
  | "slice"
  | "source"
  | "data-model"
  | "model-view-lineage";

export type RetrievalQueryStrategyEvidenceStepV1 = {
  kind: RetrievalQueryStrategyEvidenceStepKind;
  succeeded: boolean;
  evidenceAvailable: boolean;
  reason: string | null;
};

export type RetrievalQueryStrategyFileEvidenceV1 = {
  path: string;
};

export type RetrievalQueryStrategySymbolEvidenceV1 = {
  name: string;
  nodeId: string | null;
  file: string | null;
};

export type RetrievalQueryStrategyEvidenceV1 = {
  schemaVersion: "retrieval-query-strategy-evidence-v1";
  strategyId: RetrievalQueryStrategyId;
  availability: RetrievalQueryStrategyEvidenceAvailability;
  availabilityReason: string | null;
  files: RetrievalQueryStrategyFileEvidenceV1[];
  symbols: RetrievalQueryStrategySymbolEvidenceV1[];
  steps: RetrievalQueryStrategyEvidenceStepV1[];
};

/**
 * Deduplicates and canonically orders identities. Files are keyed by path; symbols by `nodeId` when
 * present, otherwise by `file + NUL + name`. Ordering is code-unit order, never locale-sensitive.
 */
export function canonicalizeQueryStrategyIdentities(
  files: readonly RetrievalQueryStrategyFileEvidenceV1[],
  symbols: readonly RetrievalQueryStrategySymbolEvidenceV1[]
): { files: RetrievalQueryStrategyFileEvidenceV1[]; symbols: RetrievalQueryStrategySymbolEvidenceV1[] } {
  const fileByPath = new Map<string, RetrievalQueryStrategyFileEvidenceV1>();
  for (const file of files) {
    if (!fileByPath.has(file.path)) fileByPath.set(file.path, { path: file.path });
  }
  const symbolByKey = new Map<string, RetrievalQueryStrategySymbolEvidenceV1>();
  for (const symbol of symbols) {
    const key = symbol.nodeId !== null ? symbol.nodeId : `${symbol.file ?? ""}\0${symbol.name}`;
    if (!symbolByKey.has(key)) {
      symbolByKey.set(key, { name: symbol.name, nodeId: symbol.nodeId, file: symbol.file });
    }
  }
  return {
    files: [...fileByPath.values()].sort((a, b) => compareCodeUnits(a.path, b.path)),
    symbols: [...symbolByKey.values()].sort(
      (a, b) =>
        compareCodeUnits(a.file ?? "", b.file ?? "") ||
        compareCodeUnits(a.name, b.name) ||
        compareCodeUnits(a.nodeId ?? "", b.nodeId ?? "")
    )
  };
}

/**
 * Converts an already-normalized `retrieval-evidence-v1` observation into the strategy-neutral
 * contract. It recalculates no identity, parses no stdout, and does not reinterpret availability.
 */
export function buildQueryStrategyEvidenceFromRetrievalEvidence(
  strategyId: CoreGraphRetrievalQueryStrategyId,
  evidence: RetrievalEvidenceV1
): RetrievalQueryStrategyEvidenceV1 {
  return {
    schemaVersion: "retrieval-query-strategy-evidence-v1",
    strategyId,
    availability: evidence.availability,
    availabilityReason: evidence.availabilityReason ?? null,
    files: evidence.files.map(({ path }) => ({ path })),
    symbols: evidence.symbols.map((symbol) => ({
      name: symbol.name,
      nodeId: symbol.nodeId ?? null,
      file: symbol.file ?? null
    })),
    steps: evidence.commands.map((command) => ({
      kind: command.family,
      succeeded: command.succeeded,
      evidenceAvailable:
        (command.parseState === "parsed" || command.parseState === "selection-attributed") &&
        command.rejectedIdentityCount === 0,
      reason: command.reason ?? null
    }))
  };
}
