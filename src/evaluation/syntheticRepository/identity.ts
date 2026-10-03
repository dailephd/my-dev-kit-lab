import { createHash } from "node:crypto";
import { normalizeSyntheticRepositoryConfig, orderCaseSpec, validateSyntheticRepositoryCaseSpec } from "./config.js";
import {
  SYNTHETIC_REPOSITORY_CONFIG_SCHEMA_ID,
  SYNTHETIC_REPOSITORY_CONFIG_SCHEMA_VERSION,
  SYNTHETIC_REPOSITORY_IDENTITY_ALGORITHM_VERSION,
  SyntheticRepositoryConfigError,
} from "./types.js";
import type { SyntheticRepositoryCaseSpecV1, SyntheticRepositoryConfigV1 } from "./types.js";

/** Canonical JSON text of one valid case: fixed key order, exact values. */
export function canonicalSyntheticRepositoryCaseText(spec: SyntheticRepositoryCaseSpecV1): string {
  return JSON.stringify(orderCaseSpec(spec));
}

/** Canonical JSON text of a normalized configuration (cases already sorted by id). */
export function canonicalSyntheticRepositoryConfigText(config: SyntheticRepositoryConfigV1): string {
  return JSON.stringify({
    schemaVersion: config.schemaVersion,
    cases: config.cases.map(orderCaseSpec),
  });
}

/**
 * SHA-256 over the UTF-8 bytes of five newline-joined lines: schema id, schema version, identity
 * algorithm version, a domain tag ("case" or "config") and the canonical JSON payload. JSON escapes every
 * newline, so the payload cannot forge an earlier line.
 */
function hashDomain(domain: "case" | "config", payload: string): string {
  const text = [
    SYNTHETIC_REPOSITORY_CONFIG_SCHEMA_ID,
    SYNTHETIC_REPOSITORY_CONFIG_SCHEMA_VERSION,
    SYNTHETIC_REPOSITORY_IDENTITY_ALGORITHM_VERSION,
    domain,
    payload,
  ].join("\n");
  return createHash("sha256").update(Buffer.from(text, "utf8")).digest("hex");
}

/** Per-case generation identity (lowercase 64-character SHA-256 hex). Throws on an invalid case. */
export function computeSyntheticRepositoryCaseIdentity(input: unknown): string {
  const result = validateSyntheticRepositoryCaseSpec(input);
  if (!result.ok) throw new SyntheticRepositoryConfigError(result.errors);
  return hashDomain("case", canonicalSyntheticRepositoryCaseText(result.spec));
}

/** Whole-configuration identity over the normalized form; input case order never matters. */
export function computeSyntheticRepositoryConfigIdentity(input: unknown): string {
  const config = normalizeSyntheticRepositoryConfig(input);
  return hashDomain("config", canonicalSyntheticRepositoryConfigText(config));
}
