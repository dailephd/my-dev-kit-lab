import {
  TARGET_CONTRACT_SCHEMA_VERSION,
  TARGET_ROOT_PLACEHOLDER,
  TUTORIAL_TARGET_PROCESS_CWDS,
  type TutorialTargetContractV1,
  type TutorialValidationResult
} from "./types.js";
import {
  createErrorCollector,
  describeValue,
  isNonEmptyString,
  isPlainObject,
  isPositiveInteger,
  rejectUnknownKeys,
  validateSchemaVersion,
  validateStableId,
  validateStringArray,
  validateStringRecord,
  type ErrorCollector
} from "./validationPrimitives.js";

const CONTRACT_KEYS = ["schemaVersion", "id", "prepare", "processes", "applicationUrl"] as const;
const PREPARE_KEYS = ["executable", "args", "env"] as const;
const PROCESS_KEYS = ["id", "executable", "args", "cwd", "env", "readiness"] as const;
const READINESS_KEYS = [
  "kind",
  "url",
  "timeoutMs",
  "intervalMs",
  "requestTimeoutMs",
  "acceptedStatusMin",
  "acceptedStatusMax"
] as const;

/**
 * Fields that would turn a declarative target contract into a shell. They are
 * already excluded by the closed key lists, but they are named explicitly so the
 * failure says why rather than only "unknown field".
 */
const FORBIDDEN_EXECUTION_FIELDS = ["shell", "commandString", "script", "javascript", "eval", "command"] as const;

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

/**
 * Validates a parsed JSON value as a TutorialTargetContractV1.
 *
 * The target contract is the trusted half of the tutorial system: it is the only
 * place that may name an executable. That trust is bounded here -- commands are
 * executable-plus-arguments only, the single permitted placeholder is
 * {{targetRoot}}, and the application origin must be loopback.
 */
export function validateTutorialTargetContract(
  value: unknown,
  source = "Target contract"
): TutorialValidationResult<TutorialTargetContractV1> {
  const errors = createErrorCollector(source);

  if (!isPlainObject(value)) {
    errors.add("<root>", `expected a JSON object, received ${describeValue(value)}.`);
    return { ok: false, errors: errors.errors };
  }

  rejectForbiddenExecutionFields(errors, "<root>", value);
  rejectUnknownKeys(errors, "<root>", value, CONTRACT_KEYS);
  validateSchemaVersion(errors, value.schemaVersion, TARGET_CONTRACT_SCHEMA_VERSION);
  validateStableId(errors, "id", value.id);

  validatePrepare(errors, value.prepare);
  validateProcesses(errors, value.processes);
  validateApplicationUrl(errors, value.applicationUrl);

  if (errors.length > 0) {
    return { ok: false, errors: errors.errors };
  }
  return { ok: true, value: value as unknown as TutorialTargetContractV1 };
}

function rejectForbiddenExecutionFields(
  errors: ErrorCollector,
  location: string,
  value: Record<string, unknown>
): void {
  for (const field of FORBIDDEN_EXECUTION_FIELDS) {
    if (field in value) {
      errors.add(
        `${location}.${field}`,
        `field ${JSON.stringify(field)} is not supported; target commands are declared as an executable plus an argument array and are never interpreted by a shell.`
      );
    }
  }
}

function validatePrepare(errors: ErrorCollector, value: unknown): void {
  if (value === undefined) {
    errors.add("prepare", "a target contract must declare a prepare command.");
    return;
  }
  if (!isPlainObject(value)) {
    errors.add("prepare", `expected a prepare command object, received ${describeValue(value)}.`);
    return;
  }
  rejectForbiddenExecutionFields(errors, "prepare", value);
  rejectUnknownKeys(errors, "prepare", value, PREPARE_KEYS);

  if (!isNonEmptyString(value.executable)) {
    errors.add(
      "prepare.executable",
      `expected a non-empty executable name or path, received ${describeValue(value.executable)}.`
    );
  }
  const args = validateStringArray(errors, "prepare.args", value.args);
  validatePlaceholders(errors, "prepare.args", args);
  const env = validateStringRecord(errors, "prepare.env", value.env);
  validateEnvPlaceholders(errors, "prepare.env", env);
}

function validateProcesses(errors: ErrorCollector, value: unknown): void {
  if (!Array.isArray(value)) {
    errors.add("processes", `expected an array of managed processes, received ${describeValue(value)}.`);
    return;
  }
  if (value.length === 0) {
    errors.add("processes", "a target contract must declare at least one managed process.");
    return;
  }

  const processIds = new Set<string>();
  value.forEach((entry, index) => {
    validateProcess(errors, `processes[${index}]`, entry, processIds);
  });
}

function validateProcess(
  errors: ErrorCollector,
  location: string,
  value: unknown,
  processIds: Set<string>
): void {
  if (!isPlainObject(value)) {
    errors.add(location, `expected a managed-process object, received ${describeValue(value)}.`);
    return;
  }
  rejectForbiddenExecutionFields(errors, location, value);
  rejectUnknownKeys(errors, location, value, PROCESS_KEYS);

  if (validateStableId(errors, `${location}.id`, value.id)) {
    if (processIds.has(value.id as string)) {
      errors.add(`${location}.id`, `duplicate process id ${JSON.stringify(value.id)}.`);
    }
    processIds.add(value.id as string);
  }

  if (!isNonEmptyString(value.executable)) {
    errors.add(
      `${location}.executable`,
      `expected a non-empty executable name or path, received ${describeValue(value.executable)}.`
    );
  }

  const args = validateStringArray(errors, `${location}.args`, value.args);
  validatePlaceholders(errors, `${location}.args`, args);
  const env = validateStringRecord(errors, `${location}.env`, value.env);
  validateEnvPlaceholders(errors, `${location}.env`, env);

  if (value.cwd !== undefined && !TUTORIAL_TARGET_PROCESS_CWDS.includes(value.cwd as never)) {
    errors.add(
      `${location}.cwd`,
      `expected one of ${TUTORIAL_TARGET_PROCESS_CWDS.join(", ")}, received ${describeValue(value.cwd)}.`
    );
  }

  validateReadiness(errors, `${location}.readiness`, value.readiness);
}

function validateReadiness(errors: ErrorCollector, location: string, value: unknown): void {
  if (!isPlainObject(value)) {
    errors.add(location, `expected a readiness probe object, received ${describeValue(value)}.`);
    return;
  }
  rejectUnknownKeys(errors, location, value, READINESS_KEYS);

  if (value.kind !== "http") {
    errors.add(`${location}.kind`, `expected "http", received ${describeValue(value.kind)}.`);
  }
  validateLoopbackUrl(errors, `${location}.url`, value.url);

  if (!isPositiveInteger(value.timeoutMs)) {
    errors.add(
      `${location}.timeoutMs`,
      `expected a finite positive integer number of milliseconds, received ${describeValue(value.timeoutMs)}.`
    );
  }

  for (const optional of ["intervalMs", "requestTimeoutMs"] as const) {
    if (value[optional] !== undefined && !isPositiveInteger(value[optional])) {
      errors.add(
        `${location}.${optional}`,
        `expected a finite positive integer number of milliseconds, received ${describeValue(value[optional])}.`
      );
    }
  }

  for (const optional of ["acceptedStatusMin", "acceptedStatusMax"] as const) {
    if (value[optional] !== undefined && !isPositiveInteger(value[optional])) {
      errors.add(
        `${location}.${optional}`,
        `expected a finite positive integer HTTP status code, received ${describeValue(value[optional])}.`
      );
    }
  }

  const min = value.acceptedStatusMin;
  const max = value.acceptedStatusMax;
  if (isPositiveInteger(min) && isPositiveInteger(max) && min > max) {
    errors.add(location, `accepted status range is inverted: ${min}..${max}.`);
  }
}

function validateApplicationUrl(errors: ErrorCollector, value: unknown): void {
  validateLoopbackUrl(errors, "applicationUrl", value);
}

/**
 * A tutorial may only drive a local application. Restricting the declared origin
 * to loopback here is what makes the later same-origin navigation and HTTP
 * assertion checks meaningful: they can only ever resolve to this machine.
 */
function validateLoopbackUrl(errors: ErrorCollector, location: string, value: unknown): void {
  if (!isNonEmptyString(value)) {
    errors.add(location, `expected a non-empty URL string, received ${describeValue(value)}.`);
    return;
  }
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    errors.add(location, `expected a valid absolute URL, received ${JSON.stringify(value)}.`);
    return;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    errors.add(location, `expected an http: or https: URL, received protocol ${parsed.protocol}.`);
    return;
  }
  const hostname = parsed.hostname.replace(/^\[/, "").replace(/\]$/, "").toLowerCase();
  if (!LOOPBACK_HOSTS.has(hostname)) {
    errors.add(
      location,
      `must use a loopback hostname (localhost, 127.0.0.1, ::1); received ${parsed.hostname}.`
    );
  }
}

function validatePlaceholders(errors: ErrorCollector, location: string, values: string[] | undefined): void {
  if (!values) {
    return;
  }
  values.forEach((entry, index) => {
    validatePlaceholderText(errors, `${location}[${index}]`, entry);
  });
}

function validateEnvPlaceholders(
  errors: ErrorCollector,
  location: string,
  env: Record<string, string> | undefined
): void {
  if (!env) {
    return;
  }
  for (const [key, entry] of Object.entries(env)) {
    validatePlaceholderText(errors, `${location}.${key}`, entry);
  }
}

/**
 * Only {{targetRoot}} is substituted. Every other `{{...}}` occurrence is a
 * validation error rather than a literal, so a contract can never rely on a
 * generic template evaluator that this repository deliberately does not have.
 */
function validatePlaceholderText(errors: ErrorCollector, location: string, value: string): void {
  const placeholderPattern = /\{\{([^}]*)\}\}/g;
  let match: RegExpExecArray | null;
  while ((match = placeholderPattern.exec(value)) !== null) {
    const whole = match[0];
    if (whole !== TARGET_ROOT_PLACEHOLDER) {
      errors.add(
        location,
        `unsupported placeholder ${JSON.stringify(whole)}; ${TARGET_ROOT_PLACEHOLDER} is the only placeholder this contract supports.`
      );
    }
  }
}

/**
 * Cross-contract identity check. Kept next to target-contract validation because
 * it is the last gate before any target work happens.
 */
export function tutorialTargetIdsMatch(scenarioTargetId: string, targetContractId: string): boolean {
  return scenarioTargetId === targetContractId;
}

export function describeTargetIdMismatch(scenarioTargetId: string, targetContractId: string): string {
  return `Tutorial scenario targetId ${JSON.stringify(scenarioTargetId)} does not match target contract id ${JSON.stringify(targetContractId)}.`;
}
