import { cpSync, existsSync, mkdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  AGENT_SUCCESS_CORPUS_PROJECT_FILES,
  AGENT_SUCCESS_CORPUS_PROJECT_IDS,
  AGENT_SUCCESS_CORPUS_TASKS,
  AGENT_SUCCESS_PROJECT_PROFILES_PATH,
  AGENT_SUCCESS_TASK_CATALOG_PATH,
  AgentSuccessCorpusError,
  assertAgentSuccessCorpus,
  assertReadAgentSuccessCorpus,
  extractPatchCandidate,
  parseUnifiedDiff,
  readAgentSuccessCorpus,
  validateAgentSuccessCorpus,
  validateAgentSuccessTask,
  validatePatchPolicy,
  type AgentSuccessCorpusIssueCode,
  type AgentSuccessTaskV1
} from "../../../src/evaluation/agentSuccess/index.js";
import { makeTempDir, useSandboxTestCleanup } from "../benchmarkSandbox/sandboxTestHelpers.js";

useSandboxTestCleanup();

const repoRoot = process.cwd();
const rawTasks = (): AgentSuccessTaskV1[] => JSON.parse(readFileSync(path.join(repoRoot, AGENT_SUCCESS_TASK_CATALOG_PATH), "utf8")) as AgentSuccessTaskV1[];
const rawProfiles = (): { schemaVersion: string; projects: Array<Record<string, unknown>> } =>
  JSON.parse(readFileSync(path.join(repoRoot, AGENT_SUCCESS_PROJECT_PROFILES_PATH), "utf8")) as { schemaVersion: string; projects: Array<Record<string, unknown>> };

function codesOf(result: ReturnType<typeof validateAgentSuccessCorpus>): AgentSuccessCorpusIssueCode[] {
  return result.ok ? [] : result.issues.map((issue) => issue.code);
}

/** A disposable repository-shaped root holding only the two catalogs and the two canonical projects. */
function copyCorpusRoot(): string {
  const root = makeTempDir("lab-asc-corpus-");
  mkdirSync(path.join(root, "benchmarks", "contracts"), { recursive: true });
  mkdirSync(path.join(root, "benchmarks", "projects"), { recursive: true });
  for (const file of [AGENT_SUCCESS_TASK_CATALOG_PATH, AGENT_SUCCESS_PROJECT_PROFILES_PATH]) {
    cpSync(path.join(repoRoot, file), path.join(root, file));
  }
  for (const project of AGENT_SUCCESS_CORPUS_PROJECT_IDS) {
    cpSync(path.join(repoRoot, "benchmarks", "projects", project), path.join(root, "benchmarks", "projects", project), { recursive: true });
  }
  return root;
}

function patchPaths(task: AgentSuccessTaskV1): string[] {
  const extracted = extractPatchCandidate(task.deterministicFixture!.patch);
  if (!extracted.ok) throw new Error("fixture patch is not extractable");
  const parsed = parseUnifiedDiff(extracted.patch);
  if (!parsed.ok) throw new Error("fixture patch does not parse");
  const policy = validatePatchPolicy(parsed.files, { protectedFiles: task.protectedFiles });
  if (!policy.ok) throw new Error("fixture patch violates policy");
  return policy.files.map((file) => file.path);
}

describe("agent-success corpus catalogs", () => {
  it("COR-001 the task catalog preserves exactly six ids in the fixed order", () => {
    expect(rawTasks().map((task) => task.id)).toEqual([
      "asr-board-title-normalization",
      "asr-board-import-idempotency",
      "asr-board-project-summary",
      "asr-inventory-quantity-boundary",
      "asr-inventory-reservation-atomicity",
      "asr-inventory-fulfillment-report"
    ]);
    expect(assertReadAgentSuccessCorpus(repoRoot).tasks.map((task) => task.id)).toEqual(AGENT_SUCCESS_CORPUS_TASKS.map((task) => task.id));
  });

  it("COR-002 the project-profile catalog preserves exactly two ids under its own schema", () => {
    const profiles = rawProfiles();
    expect(profiles.schemaVersion).toBe("my-dev-kit-lab-agent-success-project-profiles-v1");
    expect(profiles.projects.map((project) => project.projectId)).toEqual(["agent-success-task-board-node", "agent-success-inventory-node"]);
    for (const project of profiles.projects) {
      expect(project).toMatchObject({ primaryLanguage: "javascript", runtime: "node>=24", sourceRoots: ["src"], testRoots: ["tests"] });
    }
  });

  it("COR-003 every task passes the existing structural task validator", () => {
    for (const task of rawTasks()) {
      const result = validateAgentSuccessTask(task);
      expect(result.ok, task.id).toBe(true);
    }
  });

  it("COR-004 every projectProfileRef resolves to the matching project", () => {
    const profiles = new Map(rawProfiles().projects.map((project) => [project.projectId as string, project]));
    for (const task of rawTasks()) {
      expect(task.projectProfileRef).toBe(task.benchmarkProject);
      expect(profiles.has(task.projectProfileRef), task.id).toBe(true);
    }
  });

  it("COR-005 every project root is inside the controlled benchmark projects directory", () => {
    const projectsRoot = realpathSync(path.join(repoRoot, "benchmarks", "projects"));
    for (const project of rawProfiles().projects) {
      expect(project.rootPath).toBe(`benchmarks/projects/${String(project.projectId)}`);
      const physical = realpathSync(path.join(repoRoot, String(project.rootPath)));
      expect(path.dirname(physical)).toBe(projectsRoot);
    }
  });

  it("COR-006 every required source and test file exists", () => {
    for (const project of AGENT_SUCCESS_CORPUS_PROJECT_IDS) {
      for (const file of AGENT_SUCCESS_CORPUS_PROJECT_FILES[project]) {
        expect(existsSync(path.join(repoRoot, "benchmarks", "projects", project, file)), `${project}/${file}`).toBe(true);
      }
    }
    expect(readAgentSuccessCorpus(repoRoot)).toMatchObject({ ok: true });
  });

  it("COR-007 every verification check is a structured Node-only command", () => {
    for (const task of rawTasks()) {
      for (const check of [...task.taskChecks, ...task.regressionChecks]) {
        expect(check.executable).toBe("node");
        expect(check.args).toEqual(["--test", expect.stringMatching(/^tests\/[a-z-]+\.check\.mjs$/)]);
        expect(check.timeoutMs).toBe(30_000);
      }
    }
  });

  it("COR-008 each task has exactly two task checks and at least one regression check", () => {
    for (const task of rawTasks()) {
      expect(task.taskChecks, task.id).toHaveLength(2);
      expect(task.regressionChecks.length, task.id).toBeGreaterThanOrEqual(1);
    }
  });

  it("COR-009 check ids are unique within each task", () => {
    for (const task of rawTasks()) {
      const ids = [...task.taskChecks, ...task.regressionChecks].map((check) => check.id);
      expect(new Set(ids).size, task.id).toBe(ids.length);
    }
  });

  it("COR-010 every behavior-fact check reference resolves and facts cover required and optional behavior", () => {
    for (const task of rawTasks()) {
      const ids = new Set([...task.taskChecks, ...task.regressionChecks].map((check) => check.id));
      expect(task.behaviorFacts.some((fact) => fact.required), task.id).toBe(true);
      expect(task.behaviorFacts.some((fact) => !fact.required), task.id).toBe(true);
      for (const fact of task.behaviorFacts) {
        expect(fact.verificationCheckIds.length, `${task.id}/${fact.id}`).toBeGreaterThan(0);
        for (const checkId of fact.verificationCheckIds) expect(ids.has(checkId), `${task.id}/${fact.id}/${checkId}`).toBe(true);
      }
    }
  });

  it("COR-011 the expected edit scope is a subset of the allowed edit scope", () => {
    for (const task of rawTasks()) {
      expect(task.expectedEditFiles.length, task.id).toBeGreaterThan(0);
      for (const file of task.expectedEditFiles) expect(task.allowedEditFiles, task.id).toContain(file);
    }
  });

  it("COR-012 protected files never overlap allowed or expected files and cover every verification file", () => {
    for (const task of rawTasks()) {
      const scope = new Set([...task.expectedEditFiles, ...task.allowedEditFiles]);
      for (const file of task.protectedFiles) expect(scope.has(file), `${task.id}/${file}`).toBe(false);
      const checkFiles = [...task.taskChecks, ...task.regressionChecks].map((check) => check.args[1]!);
      for (const file of ["README.md", "package.json", "tests/regression.check.mjs", ...checkFiles]) {
        expect(task.protectedFiles, `${task.id}/${file}`).toContain(file);
      }
      expect(task.protectedFiles.filter((file) => file.startsWith("tests/")).length, task.id).toBe(7);
    }
  });

  it("COR-013 each project has exactly one localized, cross-module and broad-change task", () => {
    for (const project of AGENT_SUCCESS_CORPUS_PROJECT_IDS) {
      const localities = rawTasks()
        .filter((task) => task.benchmarkProject === project)
        .map((task) => task.taskLocality)
        .sort();
      expect(localities, project).toEqual(["broad-change", "cross-module", "localized"]);
    }
    const all = rawTasks().map((task) => task.taskLocality);
    expect(all.filter((locality) => locality === "localized")).toHaveLength(2);
    expect(all.filter((locality) => locality === "cross-module")).toHaveLength(2);
    expect(all.filter((locality) => locality === "broad-change")).toHaveLength(2);
  });

  it("COR-014 no task depends on another task's patch", () => {
    const tasks = rawTasks();
    const fixtureIds = tasks.map((task) => task.deterministicFixture!.id);
    expect(new Set(fixtureIds).size).toBe(tasks.length);
    expect(new Set(tasks.map((task) => task.deterministicFixture!.patch)).size).toBe(tasks.length);
    for (const task of tasks) {
      // Each patch is complete for its own task: it touches only that task's expected files, never another task's patch scope as a prerequisite.
      expect(patchPaths(task), task.id).toEqual(task.expectedEditFiles);
    }
  });

  it("COR-018 every deterministic reference patch is accepted by the extractor, parser and policy", () => {
    for (const task of rawTasks()) {
      const extracted = extractPatchCandidate(task.deterministicFixture!.patch);
      expect(extracted.ok, task.id).toBe(true);
      expect(patchPaths(task), task.id).toEqual(task.expectedEditFiles);
      expect(task.deterministicFixture!.patch.startsWith("diff --git a/"), task.id).toBe(true);
    }
  });

  it("COR-029 reference patch text does not leak through the task title, query or instruction", () => {
    for (const task of rawTasks()) {
      const visible = `${task.title}\n${task.query}\n${task.instruction}`;
      expect(visible, task.id).not.toContain("diff --git");
      expect(visible, task.id).not.toContain("@@ ");
      const changed = task
        .deterministicFixture!.patch.split("\n")
        .filter((line) => (line.startsWith("+") && !line.startsWith("+++")) || (line.startsWith("-") && !line.startsWith("---")))
        .map((line) => line.slice(1).trim())
        .filter((line) => line.length >= 12);
      expect(changed.length, task.id).toBeGreaterThan(0);
      for (const line of changed) expect(visible, `${task.id}: ${line}`).not.toContain(line);
    }
  });

  it("COR-030 source roots and globs exclude trusted tests, contracts and reference fixtures", () => {
    for (const task of rawTasks()) {
      expect(task.sourceRoots).toEqual(["src"]);
      expect(task.rawIncludeGlobs).toEqual(["src/**/*.js"]);
      for (const entry of [...task.sourceRoots, ...task.rawIncludeGlobs]) {
        expect(entry.startsWith("src")).toBe(true);
        expect(entry).not.toMatch(/tests|contracts|benchmarks|\.patch|fixture/i);
      }
    }
  });

  it("COR-030 the data separation is explicit: the fixture is a distinct field, never part of an agent-facing context projection", () => {
    // No agent-facing projection API exists yet. This documents the data boundary that Batch 4 must enforce at prompt
    // construction: everything an agent may see is listed explicitly, and deterministicFixture is never in it.
    const agentVisibleKeys = ["id", "title", "query", "instruction", "sourceRoots", "rawIncludeGlobs"] as const;
    for (const task of rawTasks()) {
      const projection = Object.fromEntries(agentVisibleKeys.map((key) => [key, task[key]]));
      const serialized = JSON.stringify(projection);
      expect(Object.keys(projection)).not.toContain("deterministicFixture");
      expect(serialized).not.toContain(task.deterministicFixture!.id);
      expect(serialized).not.toContain(task.deterministicFixture!.notes ?? "\u0000");
      expect(serialized).not.toContain(task.deterministicFixture!.patch.split("\n")[0]!);
    }
  });
});

describe("agent-success corpus structural validator", () => {
  it("accepts the committed catalogs and is deterministic", () => {
    const first = validateAgentSuccessCorpus({ profiles: rawProfiles(), tasks: rawTasks() });
    const second = validateAgentSuccessCorpus({ profiles: rawProfiles(), tasks: rawTasks() });
    expect(first.ok).toBe(true);
    expect(second).toEqual(first);
    expect(() => assertAgentSuccessCorpus({ profiles: rawProfiles(), tasks: rawTasks() })).not.toThrow();
  });

  it("COR-032 rejects a missing project", () => {
    const profiles = rawProfiles();
    profiles.projects.pop();
    expect(codesOf(validateAgentSuccessCorpus({ profiles, tasks: rawTasks() }))).toContain("PROJECT_SET_MISMATCH");
    expect(codesOf(validateAgentSuccessCorpus({ profiles, tasks: rawTasks() }))).toContain("PROJECT_REF_INVALID");
  });

  it("COR-033 rejects duplicate task ids", () => {
    const tasks = rawTasks();
    tasks[1]!.id = tasks[0]!.id;
    expect(codesOf(validateAgentSuccessCorpus({ profiles: rawProfiles(), tasks }))).toContain("TASK_ID_DUPLICATE");
  });

  it("COR-034 rejects an invalid task-to-project reference", () => {
    const unknown = rawTasks();
    unknown[0]!.projectProfileRef = "not-a-project";
    expect(codesOf(validateAgentSuccessCorpus({ profiles: rawProfiles(), tasks: unknown }))).toContain("PROJECT_REF_INVALID");
    const mismatched = rawTasks();
    mismatched[0]!.benchmarkProject = "agent-success-inventory-node";
    expect(codesOf(validateAgentSuccessCorpus({ profiles: rawProfiles(), tasks: mismatched }))).toContain("PROJECT_REF_INVALID");
  });

  it("COR-035 rejects missing, unsafe and non-Node check commands", () => {
    const traversal = rawTasks();
    traversal[0]!.taskChecks[0]!.args = ["--test", "../outside.check.mjs"];
    expect(codesOf(validateAgentSuccessCorpus({ profiles: rawProfiles(), tasks: traversal }))).toContain("CHECK_PATH_UNSAFE");

    const shellString = rawTasks();
    shellString.at(0)!.taskChecks[0]!.args = ["--test", "tests/title-primary.check.mjs && echo hi"];
    expect(codesOf(validateAgentSuccessCorpus({ profiles: rawProfiles(), tasks: shellString }))).toContain("CHECK_COMMAND_INVALID");

    const nonNode = rawTasks() as unknown as Array<{ taskChecks: Array<Record<string, unknown>> }>;
    nonNode[0]!.taskChecks[0]!.executable = "npm";
    expect(codesOf(validateAgentSuccessCorpus({ profiles: rawProfiles(), tasks: nonNode }))).toContain("TASK_INVALID");

    const tooMany = rawTasks();
    tooMany[0]!.taskChecks.push({ ...tooMany[0]!.taskChecks[0]!, id: "title-third" });
    expect(codesOf(validateAgentSuccessCorpus({ profiles: rawProfiles(), tasks: tooMany }))).toContain("CHECK_COUNT_INVALID");

    const noRegression = rawTasks();
    noRegression[0]!.regressionChecks = [];
    noRegression[0]!.behaviorFacts = noRegression[0]!.behaviorFacts.map((fact) => ({ ...fact, verificationCheckIds: fact.verificationCheckIds.filter((id) => id !== "regression") }));
    const codes = codesOf(validateAgentSuccessCorpus({ profiles: rawProfiles(), tasks: noRegression }));
    expect(codes).toContain("TASK_INVALID");
  });

  it("COR-035 the reader rejects a referenced check file that does not exist", () => {
    const root = copyCorpusRoot();
    rmSync(path.join(root, "benchmarks", "projects", "agent-success-task-board-node", "tests", "title-edge.check.mjs"));
    const result = readAgentSuccessCorpus(root);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.map((issue) => issue.code)).toContain("PROJECT_FILE_MISSING");
      expect(result.issues.map((issue) => issue.path).join("\n")).not.toContain(root);
    }
  });

  it("COR-036 rejects an invalid reference patch", () => {
    const garbage = rawTasks();
    garbage[0]!.deterministicFixture!.patch = "this is not a diff\n";
    expect(codesOf(validateAgentSuccessCorpus({ profiles: rawProfiles(), tasks: garbage }))).toContain("FIXTURE_INVALID");

    const protectedTouch = rawTasks();
    protectedTouch[0]!.deterministicFixture!.patch = protectedTouch[0]!.deterministicFixture!.patch.replaceAll("src/validation.js", "tests/regression.check.mjs");
    expect(codesOf(validateAgentSuccessCorpus({ profiles: rawProfiles(), tasks: protectedTouch }))).toContain("FIXTURE_INVALID");

    const wrongScope = rawTasks();
    wrongScope[0]!.deterministicFixture!.patch = wrongScope[0]!.deterministicFixture!.patch.replaceAll("src/validation.js", "src/index.js");
    expect(codesOf(validateAgentSuccessCorpus({ profiles: rawProfiles(), tasks: wrongScope }))).toContain("FIXTURE_SCOPE_MISMATCH");

    const missing = rawTasks();
    delete missing[0]!.deterministicFixture;
    expect(codesOf(validateAgentSuccessCorpus({ profiles: rawProfiles(), tasks: missing }))).toContain("FIXTURE_MISSING");
  });

  it("COR-036 rejects an instruction that reveals reference-patch content", () => {
    const leaky = rawTasks();
    const changedLine = leaky[0]!.deterministicFixture!.patch.split("\n").find((line) => line.startsWith("+") && !line.startsWith("+++") && line.length > 20)!;
    leaky[0]!.instruction = `${leaky[0]!.instruction} Use this: ${changedLine.slice(1).trim()}`;
    expect(codesOf(validateAgentSuccessCorpus({ profiles: rawProfiles(), tasks: leaky }))).toContain("FIXTURE_LEAKED");
  });

  it("COR-037 rejects an incorrect locality distribution", () => {
    const tasks = rawTasks();
    tasks[2]!.taskLocality = "localized";
    const codes = codesOf(validateAgentSuccessCorpus({ profiles: rawProfiles(), tasks }));
    expect(codes).toContain("LOCALITY_MISMATCH");
    expect(codes).toContain("LOCALITY_DISTRIBUTION");
  });

  it("COR-038 rejects an unexpected task count or order", () => {
    const fewer = rawTasks();
    fewer.pop();
    expect(codesOf(validateAgentSuccessCorpus({ profiles: rawProfiles(), tasks: fewer }))).toContain("TASK_COUNT_MISMATCH");

    const swapped = rawTasks();
    [swapped[0], swapped[1]] = [swapped[1]!, swapped[0]!];
    expect(codesOf(validateAgentSuccessCorpus({ profiles: rawProfiles(), tasks: swapped }))).toContain("TASK_ORDER_MISMATCH");

    const extra = rawTasks();
    extra.push({ ...structuredClone(extra[0]!), id: "asr-extra-task" });
    expect(codesOf(validateAgentSuccessCorpus({ profiles: rawProfiles(), tasks: extra }))).toContain("TASK_COUNT_MISMATCH");

    const reordered = rawProfiles();
    reordered.projects.reverse();
    expect(codesOf(validateAgentSuccessCorpus({ profiles: reordered, tasks: rawTasks() }))).toContain("PROJECT_SET_MISMATCH");
  });

  it("rejects malformed catalogs and weakened scope contracts without throwing", () => {
    expect(codesOf(validateAgentSuccessCorpus({ profiles: "nope", tasks: rawTasks() }))).toContain("PROFILES_INVALID");
    expect(codesOf(validateAgentSuccessCorpus({ profiles: rawProfiles(), tasks: {} }))).toContain("TASKS_NOT_ARRAY");

    const wrongRoot = rawProfiles();
    wrongRoot.projects[0]!.rootPath = "../outside";
    expect(codesOf(validateAgentSuccessCorpus({ profiles: wrongRoot, tasks: rawTasks() }))).toContain("PROFILE_ROOT_INVALID");

    const exposedTests = rawTasks();
    exposedTests[0]!.rawIncludeGlobs = ["src/**/*.js", "tests/**/*.mjs"];
    expect(codesOf(validateAgentSuccessCorpus({ profiles: rawProfiles(), tasks: exposedTests }))).toContain("SOURCE_SCOPE_INVALID");

    const unprotected = rawTasks();
    unprotected[0]!.protectedFiles = unprotected[0]!.protectedFiles.filter((file) => file !== "tests/regression.check.mjs");
    expect(codesOf(validateAgentSuccessCorpus({ profiles: rawProfiles(), tasks: unprotected }))).toContain("PROTECTED_SCOPE_INVALID");

    const noOptionalFact = rawTasks();
    noOptionalFact[0]!.behaviorFacts = noOptionalFact[0]!.behaviorFacts.filter((fact) => fact.required);
    expect(codesOf(validateAgentSuccessCorpus({ profiles: rawProfiles(), tasks: noOptionalFact }))).toContain("FACT_COVERAGE_INVALID");

    const issues = (validateAgentSuccessCorpus({ profiles: "nope", tasks: {} }) as { issues: Array<{ message: string }> }).issues;
    expect(() => assertAgentSuccessCorpus({ profiles: "nope", tasks: {} })).toThrow(AgentSuccessCorpusError);
    for (const issue of issues) expect(issue.message).not.toContain(repoRoot);
  });
});

describe("agent-success corpus reader", () => {
  it("accepts a faithful copy of the corpus", () => {
    expect(readAgentSuccessCorpus(copyCorpusRoot())).toMatchObject({ ok: true });
  });

  it("fails when a catalog is missing, not JSON or not a file", () => {
    const missing = copyCorpusRoot();
    rmSync(path.join(missing, AGENT_SUCCESS_TASK_CATALOG_PATH));
    expect(readAgentSuccessCorpus(missing)).toMatchObject({ ok: false, issues: [{ code: "CATALOG_MISSING" }] });

    const invalid = copyCorpusRoot();
    writeFileSync(path.join(invalid, AGENT_SUCCESS_PROJECT_PROFILES_PATH), "{ not json");
    expect(readAgentSuccessCorpus(invalid)).toMatchObject({ ok: false, issues: [{ code: "CATALOG_INVALID_JSON" }] });

    const notFile = copyCorpusRoot();
    rmSync(path.join(notFile, AGENT_SUCCESS_TASK_CATALOG_PATH));
    mkdirSync(path.join(notFile, AGENT_SUCCESS_TASK_CATALOG_PATH));
    expect(readAgentSuccessCorpus(notFile)).toMatchObject({ ok: false, issues: [{ code: "CATALOG_NOT_FILE" }] });
  });

  it("fails when a project directory is missing or is a link", () => {
    const missing = copyCorpusRoot();
    rmSync(path.join(missing, "benchmarks", "projects", "agent-success-inventory-node"), { recursive: true });
    const result = readAgentSuccessCorpus(missing);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues.map((issue) => issue.code)).toContain("PROJECT_ROOT_UNSAFE");

    const linked = copyCorpusRoot();
    const outside = makeTempDir("lab-asc-outside-");
    cpSync(path.join(linked, "benchmarks", "projects", "agent-success-inventory-node"), path.join(outside, "p"), { recursive: true });
    rmSync(path.join(linked, "benchmarks", "projects", "agent-success-inventory-node"), { recursive: true });
    symlinkSync(path.join(outside, "p"), path.join(linked, "benchmarks", "projects", "agent-success-inventory-node"), "junction");
    const escaped = readAgentSuccessCorpus(linked);
    expect(escaped.ok).toBe(false);
    if (!escaped.ok) expect(escaped.issues.map((issue) => issue.code)).toContain("PROJECT_ROOT_UNSAFE");
  });

  it("fails on links, generated output and test-discoverable names inside a project", () => {
    const root = copyCorpusRoot();
    const project = path.join(root, "benchmarks", "projects", "agent-success-task-board-node");
    const outside = makeTempDir("lab-asc-outside-");
    symlinkSync(outside, path.join(project, "src", "linked"), "junction");
    mkdirSync(path.join(project, "node_modules"));
    writeFileSync(path.join(project, "tests", "stray.test.js"), "export {};\n");
    const result = readAgentSuccessCorpus(root);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const codes = result.issues.map((issue) => issue.code);
      expect(codes).toContain("PROJECT_SYMLINK");
      expect(codes).toContain("PROJECT_FORBIDDEN_OUTPUT");
      expect(codes).toContain("PROJECT_TEST_NAMING");
    }
  });

  it("fails when package metadata is not dependency-free ESM for Node 24", () => {
    const root = copyCorpusRoot();
    const file = path.join(root, "benchmarks", "projects", "agent-success-inventory-node", "package.json");
    const metadata = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
    metadata.devDependencies = { vitest: "1.0.0" };
    metadata.engines = { node: ">=18" };
    writeFileSync(file, JSON.stringify(metadata));
    const result = readAgentSuccessCorpus(root);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues.map((issue) => issue.code)).toContain("PROJECT_METADATA_INVALID");
  });

  it("is read-only and reports bounded errors without machine paths", () => {
    const root = copyCorpusRoot();
    rmSync(path.join(root, "benchmarks", "projects", "agent-success-task-board-node", "src", "index.js"));
    const result = readAgentSuccessCorpus(root);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.length).toBeLessThanOrEqual(60);
      for (const issue of result.issues) expect(`${issue.path} ${issue.message}`).not.toContain(root);
    }
    expect(existsSync(path.join(root, "benchmarks", "projects", "agent-success-task-board-node", "src", "index.js"))).toBe(false);
  });
});
