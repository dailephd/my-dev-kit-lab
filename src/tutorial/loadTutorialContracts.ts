import { readFile } from "node:fs/promises";
import path from "node:path";
import { validateTutorialScenario } from "./scenarioValidation.js";
import { validateTutorialTargetContract } from "./targetContractValidation.js";
import type {
  TutorialScenarioV1,
  TutorialTargetContractV1,
  TutorialValidationResult
} from "./types.js";

/**
 * Contract loading follows the v0.4.6 invocation-path rule: an absolute path is
 * used as supplied, a relative path resolves against invocationCwd -- never
 * against packageRoot, workspaceRoot or the current process directory.
 */
export function resolveInvocationPath(invocationCwd: string, suppliedPath: string): string {
  return path.isAbsolute(suppliedPath) ? path.resolve(suppliedPath) : path.resolve(invocationCwd, suppliedPath);
}

export type LoadedTutorialScenario = {
  scenario: TutorialScenarioV1;
  scenarioPath: string;
};

export type LoadedTutorialTargetContract = {
  targetContract: TutorialTargetContractV1;
  targetContractPath: string;
  /** Directory containing the contract file; the "contract-root" working directory. */
  contractRoot: string;
};

export async function loadTutorialScenario(
  invocationCwd: string,
  suppliedPath: string
): Promise<TutorialValidationResult<LoadedTutorialScenario>> {
  const scenarioPath = resolveInvocationPath(invocationCwd, suppliedPath);
  const parsed = await readJsonFile(scenarioPath, "Tutorial scenario");
  if (!parsed.ok) {
    return { ok: false, errors: parsed.errors };
  }

  const validated = validateTutorialScenario(parsed.value, scenarioPath);
  if (!validated.ok) {
    return { ok: false, errors: validated.errors };
  }
  return { ok: true, value: { scenario: validated.value, scenarioPath } };
}

export async function loadTutorialTargetContract(
  invocationCwd: string,
  suppliedPath: string
): Promise<TutorialValidationResult<LoadedTutorialTargetContract>> {
  const targetContractPath = resolveInvocationPath(invocationCwd, suppliedPath);
  const parsed = await readJsonFile(targetContractPath, "Tutorial target contract");
  if (!parsed.ok) {
    return { ok: false, errors: parsed.errors };
  }

  const validated = validateTutorialTargetContract(parsed.value, targetContractPath);
  if (!validated.ok) {
    return { ok: false, errors: validated.errors };
  }
  return {
    ok: true,
    value: {
      targetContract: validated.value,
      targetContractPath,
      contractRoot: path.dirname(targetContractPath)
    }
  };
}

async function readJsonFile(
  filePath: string,
  label: string
): Promise<TutorialValidationResult<unknown>> {
  let raw: string;
  try {
    raw = await readFile(filePath, "utf8");
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return { ok: false, errors: [`${label} could not be read: ${filePath} (${reason})`] };
  }

  try {
    return { ok: true, value: JSON.parse(raw) as unknown };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return { ok: false, errors: [`${label} is not valid JSON: ${filePath} (${reason})`] };
  }
}
