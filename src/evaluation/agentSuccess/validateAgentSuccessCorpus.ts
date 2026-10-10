import {
  AGENT_SUCCESS_CORPUS_PROJECT_IDS,
  AGENT_SUCCESS_CORPUS_RAW_INCLUDE_GLOBS,
  AGENT_SUCCESS_CORPUS_TASKS,
  AGENT_SUCCESS_PROJECTS_DIRECTORY,
  AGENT_SUCCESS_PROJECT_PROFILES_SCHEMA_VERSION,
  AgentSuccessCorpusError,
  type AgentSuccessCorpusIssue,
  type AgentSuccessCorpusIssueCode,
  type AgentSuccessCorpusV1,
  type AgentSuccessCorpusValidationResult,
  type AgentSuccessProjectProfileV1
} from "./corpusTypes.js";
import { extractPatchCandidate } from "./extractPatchCandidate.js";
import { parseUnifiedDiff } from "./parseUnifiedDiff.js";
import { normalizeProjectRelativePath } from "./taskPaths.js";
import type { AgentSuccessTaskV1 } from "./taskTypes.js";
import { validateAgentSuccessTask } from "./validateAgentSuccessTask.js";
import { validatePatchPolicy } from "./validatePatchPolicy.js";

const MAX_ISSUES = 60;
const PROJECT_FIELDS = ["projectId", "displayName", "description", "rootPath", "sourceRoots", "testRoots", "primaryLanguage", "runtime"] as const;
const PROFILES_FIELDS = ["schemaVersion", "projects"] as const;
const CHECK_FILE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*\.check\.mjs$/;
const MIN_LEAK_LINE_LENGTH = 12;
/** Files every task must protect in addition to its check files. */
const ALWAYS_PROTECTED = ["README.md", "package.json", "tests/regression.check.mjs"] as const;

class Collector {
  readonly issues: AgentSuccessCorpusIssue[] = [];

  add(code: AgentSuccessCorpusIssueCode, path: string, message: string): void {
    if (this.issues.length < MAX_ISSUES) this.issues.push({ code, path, message });
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sameList(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function isStringList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

function readProfiles(collector: Collector, input: unknown): AgentSuccessProjectProfileV1[] {
  if (!isRecord(input)) {
    collector.add("PROFILES_INVALID", "profiles", "the project-profile catalog must be an object.");
    return [];
  }
  for (const key of Object.keys(input)) {
    if (!(PROFILES_FIELDS as readonly string[]).includes(key)) collector.add("PROFILES_INVALID", `profiles.${key}`, `unknown field "${key}".`);
  }
  if (input.schemaVersion !== AGENT_SUCCESS_PROJECT_PROFILES_SCHEMA_VERSION) {
    collector.add("PROFILES_INVALID", "profiles.schemaVersion", `must equal ${AGENT_SUCCESS_PROJECT_PROFILES_SCHEMA_VERSION}.`);
  }
  if (!Array.isArray(input.projects)) {
    collector.add("PROFILES_INVALID", "profiles.projects", "must be an array.");
    return [];
  }
  const profiles: AgentSuccessProjectProfileV1[] = [];
  input.projects.forEach((entry: unknown, index) => {
    const base = `profiles.projects[${index}]`;
    if (!isRecord(entry)) {
      collector.add("PROFILE_INVALID", base, "must be an object.");
      return;
    }
    for (const key of Object.keys(entry)) {
      if (!(PROJECT_FIELDS as readonly string[]).includes(key)) collector.add("PROFILE_INVALID", `${base}.${key}`, `unknown field "${key}".`);
    }
    for (const key of ["projectId", "displayName", "description", "rootPath"] as const) {
      if (typeof entry[key] !== "string" || (entry[key] as string).trim() === "") {
        collector.add("PROFILE_INVALID", `${base}.${key}`, "must be a non-empty string.");
      }
    }
    if (!isStringList(entry.sourceRoots) || !sameList(entry.sourceRoots, ["src"])) {
      collector.add("PROFILE_INVALID", `${base}.sourceRoots`, 'must equal ["src"].');
    }
    if (!isStringList(entry.testRoots) || !sameList(entry.testRoots, ["tests"])) {
      collector.add("PROFILE_INVALID", `${base}.testRoots`, 'must equal ["tests"].');
    }
    if (entry.primaryLanguage !== "javascript") collector.add("PROFILE_INVALID", `${base}.primaryLanguage`, 'must equal "javascript".');
    if (entry.runtime !== "node>=24") collector.add("PROFILE_INVALID", `${base}.runtime`, 'must equal "node>=24".');
    if (typeof entry.projectId === "string" && typeof entry.rootPath === "string") {
      const normalized = normalizeProjectRelativePath(entry.rootPath);
      const expected = `${AGENT_SUCCESS_PROJECTS_DIRECTORY}/${entry.projectId}`;
      if (!normalized.ok || normalized.path !== expected) {
        collector.add("PROFILE_ROOT_INVALID", `${base}.rootPath`, `must equal ${expected} (inside the controlled benchmark projects directory).`);
      }
    }
    profiles.push({
      projectId: String(entry.projectId ?? ""),
      displayName: String(entry.displayName ?? ""),
      description: String(entry.description ?? ""),
      rootPath: String(entry.rootPath ?? ""),
      sourceRoots: isStringList(entry.sourceRoots) ? [...entry.sourceRoots] : [],
      testRoots: isStringList(entry.testRoots) ? [...entry.testRoots] : [],
      primaryLanguage: "javascript",
      runtime: "node>=24"
    });
  });
  return profiles;
}

function validateProfileSet(collector: Collector, profiles: readonly AgentSuccessProjectProfileV1[]): void {
  const ids = profiles.map((profile) => profile.projectId);
  if (new Set(ids).size !== ids.length) collector.add("PROJECT_SET_MISMATCH", "profiles.projects", "project ids must be unique.");
  if (!sameList(ids, AGENT_SUCCESS_CORPUS_PROJECT_IDS)) {
    collector.add(
      "PROJECT_SET_MISMATCH",
      "profiles.projects",
      `expected exactly these project ids in order: ${AGENT_SUCCESS_CORPUS_PROJECT_IDS.join(", ")}.`
    );
  }
}

function checkFileOf(args: readonly string[], testRoot: string): string | null {
  if (args.length !== 2 || args[0] !== "--test") return null;
  const normalized = normalizeProjectRelativePath(args[1]);
  if (!normalized.ok) return null;
  const segments = normalized.path.split("/");
  if (segments.length !== 2 || segments[0] !== testRoot) return null;
  return CHECK_FILE_PATTERN.test(segments[1]!) ? normalized.path : null;
}

function validateChecks(collector: Collector, task: AgentSuccessTaskV1, index: number, profile: AgentSuccessProjectProfileV1 | undefined): string[] {
  const base = `tasks[${index}]`;
  if (task.taskChecks.length !== 2) collector.add("CHECK_COUNT_INVALID", `${base}.taskChecks`, "exactly two task checks are required.");
  if (task.regressionChecks.length < 1) collector.add("CHECK_COUNT_INVALID", `${base}.regressionChecks`, "at least one regression check is required.");
  const files: string[] = [];
  const testRoot = profile?.testRoots[0] ?? "tests";
  const groups = [
    ["taskChecks", task.taskChecks],
    ["regressionChecks", task.regressionChecks]
  ] as const;
  for (const [key, checks] of groups) {
    checks.forEach((check, checkIndex) => {
      const path = `${base}.${key}[${checkIndex}].args`;
      const unsafe = check.args.some((arg) => normalizeProjectRelativePath(arg).ok === false && arg !== "--test");
      const file = checkFileOf(check.args, testRoot);
      if (file === null) {
        collector.add(unsafe ? "CHECK_PATH_UNSAFE" : "CHECK_COMMAND_INVALID", path, `must be exactly ["--test", "${testRoot}/<name>.check.mjs"].`);
      } else {
        files.push(file);
      }
    });
  }
  if (new Set(files).size !== files.length) collector.add("CHECK_COMMAND_INVALID", `${base}.taskChecks`, "check files must be unique within a task.");
  return files;
}

function validateScopes(collector: Collector, task: AgentSuccessTaskV1, index: number, checkFiles: readonly string[]): void {
  const base = `tasks[${index}]`;
  if (task.expectedEditFiles.length === 0) collector.add("EDIT_SCOPE_INVALID", `${base}.expectedEditFiles`, "must not be empty.");
  for (const key of ["expectedEditFiles", "allowedEditFiles"] as const) {
    for (const file of task[key]) {
      if (!file.startsWith("src/")) collector.add("EDIT_SCOPE_INVALID", `${base}.${key}`, `${file} is outside the project source root.`);
    }
  }
  const protectedSet = new Set(task.protectedFiles);
  for (const required of [...ALWAYS_PROTECTED, ...checkFiles]) {
    if (!protectedSet.has(required)) collector.add("PROTECTED_SCOPE_INVALID", `${base}.protectedFiles`, `${required} must be protected.`);
  }
  for (const file of task.protectedFiles) {
    if (file.startsWith("src/")) collector.add("PROTECTED_SCOPE_INVALID", `${base}.protectedFiles`, `${file} is source and must not be protected.`);
  }
}

function validateFacts(collector: Collector, task: AgentSuccessTaskV1, index: number): void {
  const base = `tasks[${index}].behaviorFacts`;
  if (!task.behaviorFacts.some((fact) => fact.required)) collector.add("FACT_COVERAGE_INVALID", base, "at least one required fact is needed.");
  if (!task.behaviorFacts.some((fact) => !fact.required)) collector.add("FACT_COVERAGE_INVALID", base, "at least one optional fact is needed.");
  task.behaviorFacts.forEach((fact, factIndex) => {
    if (fact.verificationCheckIds.length === 0) {
      collector.add("FACT_COVERAGE_INVALID", `${base}[${factIndex}].verificationCheckIds`, "every fact must reference at least one check.");
    }
  });
}

function changedLines(patch: string): string[] {
  return patch
    .split("\n")
    .filter((line) => (line.startsWith("+") && !line.startsWith("+++")) || (line.startsWith("-") && !line.startsWith("---")))
    .map((line) => line.slice(1).trim())
    .filter((line) => line.length >= MIN_LEAK_LINE_LENGTH);
}

function validateFixture(collector: Collector, task: AgentSuccessTaskV1, index: number): void {
  const base = `tasks[${index}].deterministicFixture`;
  const fixture = task.deterministicFixture;
  if (fixture === undefined) {
    collector.add("FIXTURE_MISSING", base, "a deterministic reference fixture is required.");
    return;
  }
  const extracted = extractPatchCandidate(fixture.patch);
  if (!extracted.ok) {
    collector.add("FIXTURE_INVALID", base, `the reference patch is not an acceptable patch (${extracted.code}).`);
    return;
  }
  const parsed = parseUnifiedDiff(extracted.patch);
  if (!parsed.ok) {
    collector.add("FIXTURE_INVALID", base, `the reference patch does not parse (${parsed.code}).`);
    return;
  }
  const policy = validatePatchPolicy(parsed.files, { protectedFiles: task.protectedFiles });
  if (!policy.ok) {
    collector.add("FIXTURE_INVALID", base, `the reference patch violates the patch policy (${policy.rejections.map((r) => r.code).join(", ")}).`);
    return;
  }
  const paths = policy.files.map((file) => file.path);
  if (!sameList(paths, task.expectedEditFiles) || policy.files.some((file) => file.status !== "modified")) {
    collector.add("FIXTURE_SCOPE_MISMATCH", base, "the reference patch must modify exactly the task's expectedEditFiles.");
  }
  const visibleText = `${task.query}\n${task.instruction}\n${task.title}`;
  if (/(^|\n)(diff --git |@@ -)/.test(visibleText) || changedLines(fixture.patch).some((line) => visibleText.includes(line))) {
    collector.add("FIXTURE_LEAKED", `tasks[${index}]`, "the task query, title or instruction reveals reference-patch content.");
  }
}

function validateTasks(collector: Collector, input: unknown, profiles: readonly AgentSuccessProjectProfileV1[]): AgentSuccessTaskV1[] {
  if (!Array.isArray(input)) {
    collector.add("TASKS_NOT_ARRAY", "tasks", "the task catalog must be an array.");
    return [];
  }
  const tasks: AgentSuccessTaskV1[] = [];
  input.forEach((entry: unknown, index) => {
    const result = validateAgentSuccessTask(entry);
    if (!result.ok) {
      for (const issue of result.issues.slice(0, 5)) collector.add("TASK_INVALID", `tasks[${index}].${issue.path}`.replace(/\.$/, ""), `${issue.code}: ${issue.message}`);
      return;
    }
    tasks.push(result.task);
  });
  if (tasks.length !== input.length) return tasks;

  const ids = tasks.map((task) => task.id);
  const seen = new Set<string>();
  ids.forEach((id, index) => {
    if (seen.has(id)) collector.add("TASK_ID_DUPLICATE", `tasks[${index}].id`, `duplicate task id: ${id}.`);
    seen.add(id);
  });
  const expectedIds = AGENT_SUCCESS_CORPUS_TASKS.map((task) => task.id);
  if (tasks.length !== expectedIds.length) {
    collector.add("TASK_COUNT_MISMATCH", "tasks", `expected exactly ${expectedIds.length} tasks, found ${tasks.length}.`);
  } else if (!sameList(ids, expectedIds) && new Set(ids).size === ids.length) {
    collector.add("TASK_ORDER_MISMATCH", "tasks", `expected task ids in this order: ${expectedIds.join(", ")}.`);
  }

  const profileById = new Map(profiles.map((profile) => [profile.projectId, profile]));
  const fixtureIds = new Set<string>();
  const fixturePatches = new Set<string>();
  const perProject = new Map<string, string[]>();
  tasks.forEach((task, index) => {
    const base = `tasks[${index}]`;
    const expectation = AGENT_SUCCESS_CORPUS_TASKS.find((candidate) => candidate.id === task.id);
    const profile = profileById.get(task.projectProfileRef);
    if (task.projectProfileRef !== task.benchmarkProject || profile === undefined) {
      collector.add("PROJECT_REF_INVALID", `${base}.projectProfileRef`, "must equal benchmarkProject and resolve to a known project profile.");
    } else if (expectation !== undefined && expectation.project !== task.benchmarkProject) {
      collector.add("PROJECT_REF_INVALID", `${base}.benchmarkProject`, `task ${task.id} belongs to ${expectation.project}.`);
    }
    if (expectation !== undefined && expectation.locality !== task.taskLocality) {
      collector.add("LOCALITY_MISMATCH", `${base}.taskLocality`, `task ${task.id} must be ${expectation.locality}.`);
    }
    perProject.set(task.benchmarkProject, [...(perProject.get(task.benchmarkProject) ?? []), task.taskLocality]);

    const sourceRoots = profile?.sourceRoots ?? ["src"];
    if (!sameList(task.sourceRoots, sourceRoots)) {
      collector.add("SOURCE_SCOPE_INVALID", `${base}.sourceRoots`, `must equal the project's source roots (${sourceRoots.join(", ")}).`);
    }
    if (!sameList(task.rawIncludeGlobs, AGENT_SUCCESS_CORPUS_RAW_INCLUDE_GLOBS)) {
      collector.add("SOURCE_SCOPE_INVALID", `${base}.rawIncludeGlobs`, `must equal ${AGENT_SUCCESS_CORPUS_RAW_INCLUDE_GLOBS.join(", ")} so tests and contracts stay out of agent context.`);
    }
    const checkFiles = validateChecks(collector, task, index, profile);
    validateScopes(collector, task, index, checkFiles);
    validateFacts(collector, task, index);
    validateFixture(collector, task, index);
    if (task.deterministicFixture !== undefined) {
      if (fixtureIds.has(task.deterministicFixture.id)) collector.add("FIXTURE_DUPLICATE", `${base}.deterministicFixture.id`, "fixture ids must be unique.");
      if (fixturePatches.has(task.deterministicFixture.patch)) collector.add("FIXTURE_DUPLICATE", `${base}.deterministicFixture.patch`, "tasks must not share a reference patch.");
      fixtureIds.add(task.deterministicFixture.id);
      fixturePatches.add(task.deterministicFixture.patch);
    }
  });

  for (const [project, localities] of perProject) {
    const sorted = [...localities].sort();
    if (!sameList(sorted, ["broad-change", "cross-module", "localized"])) {
      collector.add("LOCALITY_DISTRIBUTION", "tasks", `project ${project} must have exactly one localized, one cross-module and one broad-change task.`);
    }
  }
  return tasks;
}

/**
 * Structural validation of the agent-success implementation corpus. Pure: it only inspects the two parsed
 * catalogs. It never touches the filesystem and never applies or executes a reference patch; that is dynamic
 * benchmark acceptance and is tested separately. The task shape is validated by validateAgentSuccessTask.
 */
export function validateAgentSuccessCorpus(input: { profiles: unknown; tasks: unknown }): AgentSuccessCorpusValidationResult {
  const collector = new Collector();
  const profiles = readProfiles(collector, input.profiles);
  validateProfileSet(collector, profiles);
  const tasks = validateTasks(collector, input.tasks, profiles);
  if (collector.issues.length > 0) return { ok: false, issues: collector.issues };
  const corpus: AgentSuccessCorpusV1 = { profiles, tasks };
  return { ok: true, corpus };
}

export function assertAgentSuccessCorpus(input: { profiles: unknown; tasks: unknown }): AgentSuccessCorpusV1 {
  const result = validateAgentSuccessCorpus(input);
  if (!result.ok) throw new AgentSuccessCorpusError(result.issues);
  return result.corpus;
}
