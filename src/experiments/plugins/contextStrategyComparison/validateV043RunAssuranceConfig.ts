import { validateTargetImmutabilityConfig } from "../../../evaluation/targetImmutability/index.js";
import type { ResolvedV043RunAssuranceConfigV1 } from "./v043RunAssuranceTypes.js";

export type V043RunAssuranceConfigIssueCode =
  | "NON_OBJECT_CONFIG"
  | "UNKNOWN_CONFIG_FIELD"
  | "INVALID_REPEAT_COUNT"
  | "INVALID_TARGET_IMMUTABILITY_CONFIG";

export interface V043RunAssuranceConfigIssue {
  code: V043RunAssuranceConfigIssueCode;
  fieldPath: string;
  message: string;
  details?: unknown;
}

export type V043RunAssuranceConfigValidationResult =
  | {
      ok: true;
      config: ResolvedV043RunAssuranceConfigV1;
    }
  | {
      ok: false;
      issues: V043RunAssuranceConfigIssue[];
    };

const ALLOWED_KEYS = ["repeatCount", "targetImmutability"];

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function validateV043RunAssuranceConfig(value: unknown): V043RunAssuranceConfigValidationResult {
  if (value === undefined) {
    return { ok: true, config: { repeatCount: 1 } };
  }
  if (!isPlainObject(value)) {
    return {
      ok: false,
      issues: [{ code: "NON_OBJECT_CONFIG", fieldPath: "", message: "v0.4.3 run-assurance config must be an object." }]
    };
  }

  const root = value;
  const issues: V043RunAssuranceConfigIssue[] = [];

  for (const key of Object.keys(root)) {
    if (!ALLOWED_KEYS.includes(key)) {
      issues.push({ code: "UNKNOWN_CONFIG_FIELD", fieldPath: key, message: `"${key}" is not a recognized field.` });
    }
  }

  let repeatCount = 1;
  if (root.repeatCount !== undefined) {
    const candidate = root.repeatCount;
    if (typeof candidate !== "number" || !Number.isInteger(candidate) || candidate < 1 || candidate > 10) {
      issues.push({
        code: "INVALID_REPEAT_COUNT",
        fieldPath: "repeatCount",
        message: "repeatCount must be an integer from 1 through 10."
      });
    } else {
      repeatCount = candidate;
    }
  }

  let targetImmutability: ResolvedV043RunAssuranceConfigV1["targetImmutability"];
  if (root.targetImmutability !== undefined) {
    const result = validateTargetImmutabilityConfig(root.targetImmutability);
    if (!result.ok) {
      issues.push({
        code: "INVALID_TARGET_IMMUTABILITY_CONFIG",
        fieldPath: "targetImmutability",
        message: "targetImmutability configuration is invalid.",
        details: result.issues
      });
    } else {
      targetImmutability = result.config;
    }
  }

  if (issues.length > 0) {
    return { ok: false, issues };
  }

  return {
    ok: true,
    config: targetImmutability !== undefined ? { repeatCount, targetImmutability } : { repeatCount }
  };
}
