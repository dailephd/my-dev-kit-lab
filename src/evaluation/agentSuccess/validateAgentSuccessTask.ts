import { TASK_LOCALITIES, type TaskLocality } from "../types.js";
import { normalizeProjectRelativePath } from "./taskPaths.js";
import {
  AGENT_SUCCESS_TASK_SCHEMA_VERSION,
  AgentSuccessTaskValidationError,
  MAX_VERIFICATION_CHECK_TIMEOUT_MS,
  type AgentSuccessTaskIssue,
  type AgentSuccessTaskIssueCode,
  type AgentSuccessTaskV1,
  type AgentSuccessTaskValidationResult,
  type BehaviorFactDefinition,
  type DeterministicFixture,
  type VerificationCheckDefinition
} from "./taskTypes.js";

const MAX_ISSUES = 50;
const MAX_SHORT_TEXT = 1000;
const MAX_INSTRUCTION = 20_000;
const MAX_FIXTURE_PATCH_BYTES = 1_048_576;
const MAX_CHECK_ARGS = 64;
const MAX_CHECK_ARG_LENGTH = 4096;
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const CHECK_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

const TASK_FIELDS = [
  "schemaVersion",
  "id",
  "title",
  "benchmarkProject",
  "projectProfileRef",
  "taskLocality",
  "query",
  "sourceRoots",
  "rawIncludeGlobs",
  "instruction",
  "expectedEditFiles",
  "allowedEditFiles",
  "protectedFiles",
  "taskChecks",
  "regressionChecks",
  "behaviorFacts",
  "deterministicFixture"
] as const;
const CHECK_FIELDS = ["id", "executable", "args", "timeoutMs"] as const;
const FACT_FIELDS = ["id", "text", "required", "verificationCheckIds"] as const;
const FIXTURE_FIELDS = ["id", "patch", "notes"] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

class IssueCollector {
  readonly issues: AgentSuccessTaskIssue[] = [];

  add(code: AgentSuccessTaskIssueCode, path: string, message: string): void {
    if (this.issues.length < MAX_ISSUES) this.issues.push({ code, path, message });
  }
}

function rejectUnknownFields(collector: IssueCollector, value: Record<string, unknown>, allowed: readonly string[], base: string): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) collector.add("UNKNOWN_FIELD", base === "" ? key : `${base}.${key}`, `unknown field "${key}".`);
  }
}

function readText(collector: IssueCollector, source: Record<string, unknown>, key: string, base: string, maxLength: number): string {
  const path = base === "" ? key : `${base}.${key}`;
  const value = source[key];
  if (value === undefined) {
    collector.add("MISSING_FIELD", path, "required field is missing.");
    return "";
  }
  if (typeof value !== "string" || value.trim() === "") {
    collector.add("INVALID_TYPE", path, "must be a non-empty string.");
    return "";
  }
  if (value.length > maxLength) {
    collector.add("INVALID_VALUE", path, `must be at most ${maxLength} characters.`);
  }
  return value;
}

function readArray(collector: IssueCollector, source: Record<string, unknown>, key: string): unknown[] | undefined {
  const value = source[key];
  if (value === undefined) {
    collector.add("MISSING_FIELD", key, "required field is missing.");
    return undefined;
  }
  if (!Array.isArray(value)) {
    collector.add("INVALID_TYPE", key, "must be an array.");
    return undefined;
  }
  return value;
}

/** Normalizes, rejects duplicates, and returns the list sorted in code-unit order. */
function readPathList(collector: IssueCollector, source: Record<string, unknown>, key: string, requireNonEmpty: boolean): string[] {
  const raw = readArray(collector, source, key);
  if (raw === undefined) return [];
  if (requireNonEmpty && raw.length === 0) collector.add("INVALID_VALUE", key, "must not be empty.");
  const seen = new Set<string>();
  raw.forEach((entry, index) => {
    const normalized = normalizeProjectRelativePath(entry);
    const path = `${key}[${index}]`;
    if (!normalized.ok) {
      collector.add(normalized.code, path, `unsafe or malformed project-relative path.`);
      return;
    }
    if (seen.has(normalized.path)) {
      collector.add("DUPLICATE_PATH", path, `duplicate path after normalization: ${normalized.path}.`);
      return;
    }
    seen.add(normalized.path);
  });
  return [...seen].sort();
}

function readGlobList(collector: IssueCollector, source: Record<string, unknown>, key: string): string[] {
  const raw = readArray(collector, source, key);
  if (raw === undefined) return [];
  if (raw.length === 0) collector.add("INVALID_VALUE", key, "must not be empty.");
  const globs: string[] = [];
  raw.forEach((entry, index) => {
    const path = `${key}[${index}]`;
    if (typeof entry !== "string" || entry.trim() === "" || entry.includes("\0")) {
      collector.add("INVALID_TYPE", path, "must be a non-empty string without NUL.");
    } else if (/^([A-Za-z]:|[\\/])/.test(entry) || entry.replace(/\\/g, "/").split("/").includes("..")) {
      collector.add("INVALID_VALUE", path, "must be a project-relative glob without traversal.");
    } else {
      globs.push(entry);
    }
  });
  return globs;
}

function readChecks(collector: IssueCollector, source: Record<string, unknown>, key: string): VerificationCheckDefinition[] {
  const raw = readArray(collector, source, key);
  if (raw === undefined) return [];
  if (raw.length < 1) collector.add("TOO_FEW_CHECKS", key, "at least one check is required.");
  const checks: VerificationCheckDefinition[] = [];
  raw.forEach((entry, index) => {
    const base = `${key}[${index}]`;
    if (!isRecord(entry)) {
      collector.add("NOT_OBJECT", base, "must be an object.");
      return;
    }
    rejectUnknownFields(collector, entry, CHECK_FIELDS, base);
    const id = entry.id;
    if (typeof id !== "string" || !CHECK_ID_PATTERN.test(id)) {
      collector.add("INVALID_VALUE", `${base}.id`, `must match ${CHECK_ID_PATTERN.source}.`);
    }
    if (entry.executable !== "node") {
      collector.add("INVALID_EXECUTABLE", `${base}.executable`, 'the only supported executable is "node".');
    }
    const args = entry.args;
    if (
      !Array.isArray(args) ||
      args.length > MAX_CHECK_ARGS ||
      !args.every((arg) => typeof arg === "string" && !arg.includes("\0") && arg.length <= MAX_CHECK_ARG_LENGTH)
    ) {
      collector.add("INVALID_TYPE", `${base}.args`, `must be an array of at most ${MAX_CHECK_ARGS} strings without NUL.`);
    }
    const timeoutMs = entry.timeoutMs;
    if (typeof timeoutMs !== "number" || !Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > MAX_VERIFICATION_CHECK_TIMEOUT_MS) {
      collector.add("INVALID_TIMEOUT", `${base}.timeoutMs`, `must be a finite number in (0, ${MAX_VERIFICATION_CHECK_TIMEOUT_MS}].`);
    }
    if (typeof id === "string" && Array.isArray(args) && typeof timeoutMs === "number") {
      checks.push({ id, executable: "node", args: args as string[], timeoutMs });
    }
  });
  return checks;
}

function readFacts(collector: IssueCollector, source: Record<string, unknown>, checkIds: ReadonlySet<string>): BehaviorFactDefinition[] {
  const raw = readArray(collector, source, "behaviorFacts");
  if (raw === undefined) return [];
  const facts: BehaviorFactDefinition[] = [];
  const seen = new Set<string>();
  raw.forEach((entry, index) => {
    const base = `behaviorFacts[${index}]`;
    if (!isRecord(entry)) {
      collector.add("NOT_OBJECT", base, "must be an object.");
      return;
    }
    rejectUnknownFields(collector, entry, FACT_FIELDS, base);
    const id = readText(collector, entry, "id", base, 128);
    const text = readText(collector, entry, "text", base, MAX_SHORT_TEXT);
    if (id !== "" && seen.has(id)) collector.add("DUPLICATE_FACT_ID", `${base}.id`, `duplicate fact id: ${id}.`);
    seen.add(id);
    if (typeof entry.required !== "boolean") collector.add("INVALID_TYPE", `${base}.required`, "must be a boolean.");
    const ids = entry.verificationCheckIds;
    if (!Array.isArray(ids) || !ids.every((value) => typeof value === "string")) {
      collector.add("INVALID_TYPE", `${base}.verificationCheckIds`, "must be an array of strings.");
      return;
    }
    ids.forEach((checkId, checkIndex) => {
      if (!checkIds.has(checkId as string)) {
        collector.add("UNRESOLVED_CHECK_ID", `${base}.verificationCheckIds[${checkIndex}]`, `unknown check id: ${checkId}.`);
      }
    });
    if (entry.required === true && ids.length === 0) {
      collector.add("REQUIRED_FACT_UNMAPPED", `${base}.verificationCheckIds`, "a required fact must reference at least one check.");
    }
    facts.push({ id, text, required: entry.required === true, verificationCheckIds: [...(ids as string[])] });
  });
  return facts;
}

function readFixture(collector: IssueCollector, source: Record<string, unknown>): DeterministicFixture | undefined {
  const raw = source.deterministicFixture;
  if (raw === undefined) return undefined;
  if (!isRecord(raw)) {
    collector.add("NOT_OBJECT", "deterministicFixture", "must be an object.");
    return undefined;
  }
  rejectUnknownFields(collector, raw, FIXTURE_FIELDS, "deterministicFixture");
  const id = readText(collector, raw, "id", "deterministicFixture", 128);
  const patch = readText(collector, raw, "patch", "deterministicFixture", MAX_FIXTURE_PATCH_BYTES);
  const fixture: DeterministicFixture = { id, patch };
  if (raw.notes !== undefined) {
    if (typeof raw.notes === "string") fixture.notes = raw.notes;
    else collector.add("INVALID_TYPE", "deterministicFixture.notes", "must be a string.");
  }
  return fixture;
}

/**
 * Validates an AgentSuccessTaskV1 candidate. Closed-set: unknown fields are rejected. Returns the normalized
 * task (POSIX paths, sorted, de-duplicated by rejection) or a bounded, deterministically ordered issue list.
 */
export function validateAgentSuccessTask(input: unknown): AgentSuccessTaskValidationResult {
  const collector = new IssueCollector();
  if (!isRecord(input)) {
    collector.add("NOT_OBJECT", "", "a task must be an object.");
    return { ok: false, issues: collector.issues };
  }
  rejectUnknownFields(collector, input, TASK_FIELDS, "");
  if (input.schemaVersion !== AGENT_SUCCESS_TASK_SCHEMA_VERSION) {
    collector.add("INVALID_SCHEMA_VERSION", "schemaVersion", `must equal ${AGENT_SUCCESS_TASK_SCHEMA_VERSION}.`);
  }

  const id = readText(collector, input, "id", "", 128);
  if (id !== "" && !ID_PATTERN.test(id)) collector.add("INVALID_VALUE", "id", `must match ${ID_PATTERN.source}.`);
  const title = readText(collector, input, "title", "", MAX_SHORT_TEXT);
  const benchmarkProject = readText(collector, input, "benchmarkProject", "", MAX_SHORT_TEXT);
  const projectProfileRef = readText(collector, input, "projectProfileRef", "", MAX_SHORT_TEXT);
  const query = readText(collector, input, "query", "", MAX_SHORT_TEXT);
  const instruction = readText(collector, input, "instruction", "", MAX_INSTRUCTION);
  const taskLocality = input.taskLocality;
  if (!(TASK_LOCALITIES as readonly unknown[]).includes(taskLocality)) {
    collector.add("INVALID_VALUE", "taskLocality", `must be one of ${TASK_LOCALITIES.join(", ")}.`);
  }

  const sourceRoots = readPathList(collector, input, "sourceRoots", true);
  const rawIncludeGlobs = readGlobList(collector, input, "rawIncludeGlobs");
  const expectedEditFiles = readPathList(collector, input, "expectedEditFiles", false);
  const allowedEditFiles = readPathList(collector, input, "allowedEditFiles", false);
  const protectedFiles = readPathList(collector, input, "protectedFiles", false);

  const allowed = new Set(allowedEditFiles);
  expectedEditFiles.forEach((file) => {
    if (!allowed.has(file)) collector.add("EXPECTED_NOT_ALLOWED", "expectedEditFiles", `${file} is not in allowedEditFiles.`);
  });
  const protectedSet = new Set(protectedFiles);
  for (const file of [...expectedEditFiles, ...allowedEditFiles]) {
    if (protectedSet.has(file)) collector.add("PROTECTED_OVERLAP", "protectedFiles", `${file} is also an expected or allowed edit file.`);
  }

  const taskChecks = readChecks(collector, input, "taskChecks");
  const regressionChecks = readChecks(collector, input, "regressionChecks");
  const checkIds = new Set<string>();
  for (const check of [...taskChecks, ...regressionChecks]) {
    if (checkIds.has(check.id)) collector.add("DUPLICATE_CHECK_ID", "taskChecks", `check id used more than once: ${check.id}.`);
    checkIds.add(check.id);
  }
  const behaviorFacts = readFacts(collector, input, checkIds);
  const deterministicFixture = readFixture(collector, input);

  if (collector.issues.length > 0) {
    return { ok: false, issues: collector.issues };
  }
  const task: AgentSuccessTaskV1 = {
    schemaVersion: AGENT_SUCCESS_TASK_SCHEMA_VERSION,
    id,
    title,
    benchmarkProject,
    projectProfileRef,
    taskLocality: taskLocality as TaskLocality,
    query,
    sourceRoots,
    rawIncludeGlobs,
    instruction,
    expectedEditFiles,
    allowedEditFiles,
    protectedFiles,
    taskChecks,
    regressionChecks,
    behaviorFacts,
    ...(deterministicFixture ? { deterministicFixture } : {})
  };
  return { ok: true, task };
}

/** Throwing variant for callers that treat an invalid task as a programming/configuration error. */
export function assertAgentSuccessTask(input: unknown): AgentSuccessTaskV1 {
  const result = validateAgentSuccessTask(input);
  if (!result.ok) throw new AgentSuccessTaskValidationError(result.issues);
  return result.task;
}
