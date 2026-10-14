import { createHash } from "node:crypto";
import {
  AGENT_SUCCESS_PROMPT_EXPLANATION_MODES,
  AGENT_SUCCESS_PROMPT_LENGTH_MODES,
  AGENT_SUCCESS_PROMPT_TEMPLATE_IDS,
  AGENT_SUCCESS_PROMPT_TOOL_USE_MODES,
  REAL_AGENT_CONTEXT_BEGIN,
  REAL_AGENT_CONTEXT_END,
  describeAgentSuccessPromptInstructions,
  isLegacyDefaultPromptSettings,
  type AgentSuccessPromptSettings
} from "./realAgentPrompt.js";

/**
 * PromptContractV1 is the typed, persisted identity of the effective patch-generation prompt for one provider. It is
 * deliberately separate from the context-treatment identity (raw-full-file / context-pack): that identity names the
 * context transport, this one names the instruction template. It never carries source/context bodies, trusted checks
 * or provider output.
 */
export const PROMPT_CONTRACT_SCHEMA_VERSION = "1.0.0";
export const PROMPT_CONTRACT_ARTIFACT_FILE = "prompt-contract.json";

export type PromptContractV1 = {
  schemaVersion: typeof PROMPT_CONTRACT_SCHEMA_VERSION;
  templateId: AgentSuccessPromptSettings["templateId"];
  providerId: AgentSuccessPromptSettings["providerId"];
  lengthMode: AgentSuccessPromptSettings["lengthMode"];
  explanationMode: AgentSuccessPromptSettings["explanationMode"];
  toolUseMode: AgentSuccessPromptSettings["toolUseMode"];
  maxCommandCount: 0;
  rendererDigest: string;
};

export type PromptContractSelection = Partial<Omit<AgentSuccessPromptSettings, "providerId">>;

const CONTRACT_FIELDS = ["schemaVersion", "templateId", "providerId", "lengthMode", "explanationMode", "toolUseMode", "maxCommandCount", "rendererDigest"] as const;

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

/** Sorted-key canonical JSON for flat, finite, string/number/array/object data (the only shapes this module hashes). */
function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "number" || typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(",")}}`;
}

/**
 * Digest of the normalized, versioned template definition: the effective settings plus the exact instruction lines and
 * context delimiters the renderer emits for them. It never reads task data, the answer key or hidden checks.
 */
export function computePromptRendererDigest(settings: AgentSuccessPromptSettings): string {
  return sha256(
    canonicalJson({
      definition: "my-dev-kit-lab-agent-success-rate-prompt-template-v1",
      settings: {
        templateId: settings.templateId,
        providerId: settings.providerId,
        lengthMode: settings.lengthMode,
        explanationMode: settings.explanationMode,
        toolUseMode: settings.toolUseMode,
        maxCommandCount: settings.maxCommandCount
      },
      delimiters: [REAL_AGENT_CONTEXT_BEGIN, REAL_AGENT_CONTEXT_END],
      instructions: describeAgentSuccessPromptInstructions(settings)
    })
  );
}

/** Normalizes a selection (omitted fields take the inherited defaults) into a complete contract. */
export function createPromptContract(providerId: PromptContractV1["providerId"], selection: PromptContractSelection = {}): PromptContractV1 {
  const settings: AgentSuccessPromptSettings = {
    templateId: selection.templateId ?? "legacy-diff-v1",
    providerId,
    lengthMode: selection.lengthMode ?? "standard",
    explanationMode: selection.explanationMode ?? "legacy",
    toolUseMode: selection.toolUseMode ?? "prohibited",
    maxCommandCount: selection.maxCommandCount ?? 0
  };
  const contract: PromptContractV1 = {
    schemaVersion: PROMPT_CONTRACT_SCHEMA_VERSION,
    templateId: settings.templateId,
    providerId,
    lengthMode: settings.lengthMode,
    explanationMode: settings.explanationMode,
    toolUseMode: settings.toolUseMode,
    maxCommandCount: 0,
    rendererDigest: computePromptRendererDigest(settings)
  };
  assertPromptContractShape(contract);
  return contract;
}

/** Throws on unknown fields, missing fields or out-of-vocabulary values. Does not recompute the renderer digest. */
export function assertPromptContractShape(value: unknown): asserts value is PromptContractV1 {
  const fail = (reason: string): never => {
    throw new Error(`INVALID_PROMPT_CONTRACT: ${reason}`);
  };
  if (typeof value !== "object" || value === null || Array.isArray(value)) fail("not an object");
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  if (keys.join("\0") !== [...CONTRACT_FIELDS].sort().join("\0")) fail("fields are not exactly the PromptContractV1 fields");
  if (record.schemaVersion !== PROMPT_CONTRACT_SCHEMA_VERSION) fail("unsupported schemaVersion");
  if (!(AGENT_SUCCESS_PROMPT_TEMPLATE_IDS as readonly unknown[]).includes(record.templateId)) fail("unknown templateId");
  if (record.providerId !== "codex" && record.providerId !== "claude") fail("unknown providerId");
  if (!(AGENT_SUCCESS_PROMPT_LENGTH_MODES as readonly unknown[]).includes(record.lengthMode)) fail("unknown lengthMode");
  if (!(AGENT_SUCCESS_PROMPT_EXPLANATION_MODES as readonly unknown[]).includes(record.explanationMode)) fail("unknown explanationMode");
  if (!(AGENT_SUCCESS_PROMPT_TOOL_USE_MODES as readonly unknown[]).includes(record.toolUseMode)) fail("unknown toolUseMode");
  if (record.maxCommandCount !== 0) fail("maxCommandCount must be 0");
  if (typeof record.rendererDigest !== "string" || !/^[a-f0-9]{64}$/.test(record.rendererDigest)) fail("invalid rendererDigest");
}

/** True when the contract's renderer digest equals the digest the current renderer produces for its settings. */
export function promptContractMatchesCurrentRenderer(contract: PromptContractV1): boolean {
  return contract.rendererDigest === computePromptRendererDigest(promptSettingsOf(contract));
}

export function promptSettingsOf(contract: PromptContractV1): AgentSuccessPromptSettings {
  return {
    templateId: contract.templateId,
    providerId: contract.providerId,
    lengthMode: contract.lengthMode,
    explanationMode: contract.explanationMode,
    toolUseMode: contract.toolUseMode,
    maxCommandCount: contract.maxCommandCount
  };
}

export function promptContractDigest(contract: PromptContractV1): string {
  assertPromptContractShape(contract);
  return sha256(canonicalJson(contract));
}

export function isLegacyDefaultPromptContract(contract: PromptContractV1): boolean {
  return isLegacyDefaultPromptSettings(contract);
}

/** Exact bytes of the per-attempt prompt-contract.json artifact; deterministic, so recovery can recompute and compare. */
export function renderPromptContractArtifact(contract: PromptContractV1): string {
  return `${canonicalJson({ promptContract: contract, promptContractDigest: promptContractDigest(contract) })}\n`;
}
