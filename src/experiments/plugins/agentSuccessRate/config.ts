import { parseCommandString } from "../../../core/commandLine.js";
import { invalidExperimentConfig, isPlainObject, mergeConfig, validExperimentConfig } from "../../config.js";
import type { ExperimentConfigDefinition, ExperimentConfigValidationResult } from "../../types.js";
import { DEFAULT_AGENT_SUCCESS_KIT_COMMAND } from "./contextGeneration.js";
import { AGENT_SUCCESS_RATE_MAX_AGENT_TIMEOUT_MS } from "./realAgentExecution.js";

export const AGENT_SUCCESS_RATE_REAL_AGENT_IDS = ["codex", "claude"] as const;
export type AgentSuccessRateRealAgentId = (typeof AGENT_SUCCESS_RATE_REAL_AGENT_IDS)[number];

/**
 * Closed config. Deterministic-fixture mode is the default. Real-agent mode is entered only by naming exactly one
 * provider together with an explicit includeRealAgents=true. Repair, preset, strategy, command-template and
 * corpus-path options are deliberately NOT fields, and there is no treatment selector because both treatments are
 * mandatory.
 */
export type AgentSuccessRateConfig = {
  outDir: string;
  caseIds?: string[];
  benchmarkProjects?: string[];
  agentId?: AgentSuccessRateRealAgentId;
  includeRealAgents?: boolean;
  timeoutMs?: number;
  kitCommand?: string;
};

export const defaultAgentSuccessRateConfig: AgentSuccessRateConfig = {
  outDir: "lab-output/agent-success-rate"
};

const SUPPORTED_FIELDS = ["outDir", "caseIds", "benchmarkProjects", "agentId", "includeRealAgents", "timeoutMs", "kitCommand"] as const;

/** Names that are recognized only to give a precise rejection. */
const REJECTED_FIELD_MESSAGES: Record<string, string> = {
  commandTemplate: "commandTemplate is not supported; real providers use the fixed adapter invocation.",
  campaignPreset: "campaignPreset is not supported by agent-success-rate.",
  repairAttempts: "repairAttempts is not supported; each treatment gets exactly one provider attempt.",
  strategies: "strategies is not supported; the two treatments are fixed.",
  agentIds: "agentIds is not supported; exactly one provider is selected per run.",
  agents: "agents is not supported; exactly one provider is selected per run."
};

export const agentSuccessRateConfigDefinition: ExperimentConfigDefinition = {
  fields: [
    { name: "outDir", type: "string", required: true, description: "Experiment output root." },
    { name: "caseIds", type: "array", description: "Task IDs to include; input order is preserved." },
    { name: "benchmarkProjects", type: "array", description: "Benchmark project IDs to include; input order is preserved." },
    { name: "agentId", type: "string", description: "Real provider for real-agent mode: codex or claude. Absent selects deterministic-fixture mode." },
    { name: "includeRealAgents", type: "boolean", description: "Must be exactly true whenever agentId is set; rejected otherwise." },
    { name: "timeoutMs", type: "number", description: "Per-attempt provider timeout in ms (real-agent mode only)." },
    { name: "kitCommand", type: "string", description: "my-dev-kit command used for context-pack retrieval (real-agent mode only)." }
  ]
};

export function validateAgentSuccessRateConfig(config: unknown): ExperimentConfigValidationResult<AgentSuccessRateConfig> {
  if (config !== undefined && !isPlainObject(config)) {
    return invalidExperimentConfig(["agent success rate config must be an object."]);
  }
  const errors: string[] = [];
  const raw = isPlainObject(config) ? config : {};
  const unsupported = Object.keys(raw).filter((key) => !(SUPPORTED_FIELDS as readonly string[]).includes(key));
  const explained = unsupported.filter((key) => key in REJECTED_FIELD_MESSAGES);
  const unknown = unsupported.filter((key) => !(key in REJECTED_FIELD_MESSAGES));
  for (const key of explained.sort()) errors.push(REJECTED_FIELD_MESSAGES[key]!);
  if (unknown.length > 0) {
    errors.push(`Unsupported agent-success-rate config field(s): ${unknown.sort().join(", ")}.`);
  }
  const normalized = mergeConfig(defaultAgentSuccessRateConfig, config);
  const outDir: unknown = normalized.outDir;
  if (typeof outDir !== "string" || !outDir.trim()) errors.push("outDir must be a non-empty string.");
  for (const field of ["caseIds", "benchmarkProjects"] as const) {
    const value: unknown = normalized[field];
    if (value === undefined) continue;
    if (!Array.isArray(value) || value.length === 0 || !value.every((item) => typeof item === "string" && item.trim())) {
      errors.push(`${field} must be a non-empty array of non-empty strings when provided.`);
    } else if (new Set(value).size !== value.length) {
      errors.push(`${field} must not contain duplicate entries.`);
    }
  }

  // Real-agent fields are validated against the RAW object so defaults can never look like an opt-in.
  const agentId = raw.agentId;
  if (agentId === undefined) {
    if (raw.includeRealAgents === true) errors.push("includeRealAgents requires agentId; real-agent mode is entered only by naming one provider.");
    else if (raw.includeRealAgents !== undefined && typeof raw.includeRealAgents !== "boolean") errors.push("includeRealAgents must be a boolean.");
    if (raw.timeoutMs !== undefined) errors.push("timeoutMs is only supported together with agentId.");
    if (raw.kitCommand !== undefined) errors.push("kitCommand is only supported together with agentId.");
  } else {
    if (Array.isArray(agentId)) {
      errors.push("agentId must name exactly one provider (codex or claude); multiple providers are not supported.");
    } else if (typeof agentId !== "string" || !(AGENT_SUCCESS_RATE_REAL_AGENT_IDS as readonly string[]).includes(agentId)) {
      errors.push(`agentId must be one of: ${AGENT_SUCCESS_RATE_REAL_AGENT_IDS.join(", ")}.`);
    }
    if (raw.includeRealAgents !== true) errors.push("agentId requires includeRealAgents to be exactly true.");
    if (raw.timeoutMs !== undefined) {
      const timeoutMs = raw.timeoutMs;
      if (typeof timeoutMs !== "number" || !Number.isFinite(timeoutMs) || !Number.isInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > AGENT_SUCCESS_RATE_MAX_AGENT_TIMEOUT_MS) {
        errors.push(`timeoutMs must be a finite positive integer no greater than ${AGENT_SUCCESS_RATE_MAX_AGENT_TIMEOUT_MS}.`);
      }
    }
    if (raw.kitCommand !== undefined) {
      const kitCommand = raw.kitCommand;
      let supported = false;
      if (typeof kitCommand === "string" && kitCommand.trim()) {
        try {
          supported = parseCommandString(kitCommand).executable.length > 0;
        } catch {
          supported = false;
        }
      }
      if (!supported) errors.push("kitCommand must be a non-empty my-dev-kit command string.");
    } else {
      normalized.kitCommand = DEFAULT_AGENT_SUCCESS_KIT_COMMAND;
    }
  }
  return errors.length > 0 ? invalidExperimentConfig(errors) : validExperimentConfig(normalized);
}
