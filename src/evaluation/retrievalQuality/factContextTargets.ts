import { normalizeRetrievedRepositoryPath } from "./buildRetrievalEvidence.js";

/** A validated fact-mapped context target with normalized identities. */
export type InterpretedFactContextTarget = {
  /** Safe normalized repository-relative file. */
  file: string;
  /** Distinct nonempty symbol names the target requires in that file; empty means file-only. */
  symbols: string[];
  /** False only when the target explicitly sets `required: false`. */
  required: boolean;
  /** Distinct fact ids this target supports. */
  factIds: string[];
};

export type FactContextTargetInterpretation =
  | { ok: true; target: InterpretedFactContextTarget }
  | { ok: false; problem: string };

/** True when the target participates in fact mapping, i.e. it carries a `factIds` field. */
export function hasFactMapping(target: unknown): boolean {
  return typeof target === "object" && target !== null && !Array.isArray(target) && (target as Record<string, unknown>).factIds !== undefined;
}

/**
 * Single owner of the `ExpectedContextTarget.factIds` contract. Pure. Problems are fixed bounded strings and
 * never echo the offending value. Unsafe file identities are rejected, never repaired.
 */
export function interpretFactContextTarget(target: unknown, knownFactIds: ReadonlySet<string>): FactContextTargetInterpretation {
  if (typeof target !== "object" || target === null || Array.isArray(target)) {
    return { ok: false, problem: "target must be an object" };
  }
  const record = target as Record<string, unknown>;
  const file = normalizeRetrievedRepositoryPath(record.file);
  if (file === null) {
    return { ok: false, problem: "file must be a safe repository-relative path" };
  }
  const rawFactIds = record.factIds;
  if (!Array.isArray(rawFactIds) || rawFactIds.length === 0 || rawFactIds.some((id) => typeof id !== "string" || id.length === 0)) {
    return { ok: false, problem: "factIds must be a nonempty array of nonempty strings" };
  }
  const factIds = rawFactIds as string[];
  if (new Set(factIds).size !== factIds.length) {
    return { ok: false, problem: "factIds must not contain duplicates" };
  }
  if (factIds.some((id) => !knownFactIds.has(id))) {
    return { ok: false, problem: "factIds must reference existing expectedFacts ids" };
  }
  let symbols: string[] = [];
  if (record.symbols !== undefined) {
    if (!Array.isArray(record.symbols) || record.symbols.some((symbol) => typeof symbol !== "string" || symbol.length === 0)) {
      return { ok: false, problem: "symbols must be an array of nonempty strings" };
    }
    symbols = record.symbols as string[];
    if (new Set(symbols).size !== symbols.length) {
      return { ok: false, problem: "symbols must not contain duplicates" };
    }
  }
  if (record.required !== undefined && typeof record.required !== "boolean") {
    return { ok: false, problem: "required must be a boolean when present" };
  }
  return { ok: true, target: { file, symbols: [...symbols], required: record.required !== false, factIds: [...factIds] } };
}
