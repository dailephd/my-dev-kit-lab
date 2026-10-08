import { lstatSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import path from "node:path";
import {
  AGENT_SUCCESS_CORPUS_FORBIDDEN_DIRECTORIES,
  AGENT_SUCCESS_CORPUS_PROJECT_FILES,
  AGENT_SUCCESS_PROJECTS_DIRECTORY,
  AGENT_SUCCESS_PROJECT_PROFILES_PATH,
  AGENT_SUCCESS_TASK_CATALOG_PATH,
  AgentSuccessCorpusError,
  type AgentSuccessCorpusIssue,
  type AgentSuccessCorpusIssueCode,
  type AgentSuccessCorpusProjectId,
  type AgentSuccessCorpusV1,
  type AgentSuccessProjectProfileV1
} from "./corpusTypes.js";
import type { AgentSuccessTaskV1 } from "./taskTypes.js";
import { validateAgentSuccessCorpus } from "./validateAgentSuccessCorpus.js";

const MAX_TREE_ENTRIES = 2_000;
const MAX_ISSUES = 60;
const MAX_CATALOG_BYTES = 4 * 1024 * 1024;
const TEST_NAMING_PATTERN = /\.(test|spec)\.[cm]?[jt]sx?$/i;

export type AgentSuccessCorpusReadResult =
  | { ok: true; corpus: AgentSuccessCorpusV1 }
  | { ok: false; issues: AgentSuccessCorpusIssue[] };

class Collector {
  readonly issues: AgentSuccessCorpusIssue[] = [];

  add(code: AgentSuccessCorpusIssueCode, issuePath: string, message: string): void {
    if (this.issues.length < MAX_ISSUES) this.issues.push({ code, path: issuePath, message });
  }
}

function readCatalog(collector: Collector, rootDir: string, relativePath: string): { found: boolean; value?: unknown } {
  const absolute = path.join(rootDir, ...relativePath.split("/"));
  let stats;
  try {
    stats = lstatSync(absolute);
  } catch {
    collector.add("CATALOG_MISSING", relativePath, "the catalog file is missing.");
    return { found: false };
  }
  if (!stats.isFile() || stats.isSymbolicLink()) {
    collector.add("CATALOG_NOT_FILE", relativePath, "the catalog must be a regular file, not a link or directory.");
    return { found: false };
  }
  if (stats.size > MAX_CATALOG_BYTES) {
    collector.add("CATALOG_UNREADABLE", relativePath, `the catalog exceeds ${MAX_CATALOG_BYTES} bytes.`);
    return { found: false };
  }
  let text: string;
  try {
    text = readFileSync(absolute, "utf8");
  } catch {
    collector.add("CATALOG_UNREADABLE", relativePath, "the catalog could not be read.");
    return { found: false };
  }
  try {
    return { found: true, value: JSON.parse(text) as unknown };
  } catch (error) {
    collector.add("CATALOG_INVALID_JSON", relativePath, `the catalog is not valid JSON (${error instanceof Error ? error.name : "error"}).`);
    return { found: false };
  }
}

function realDirectory(absolute: string): string | null {
  try {
    if (lstatSync(absolute).isSymbolicLink()) return null;
    return realpathSync(absolute);
  } catch {
    return null;
  }
}

function isInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

/** Lists project-relative POSIX paths of every entry below `projectRoot`, using lstat so links are never followed. */
function walkProject(
  collector: Collector,
  projectRoot: string,
  label: string
): { files: Set<string>; directories: Set<string> } {
  const files = new Set<string>();
  const directories = new Set<string>();
  let visited = 0;
  const visit = (relative: string): void => {
    const directory = relative === "" ? projectRoot : path.join(projectRoot, ...relative.split("/"));
    for (const name of readdirSync(directory).sort()) {
      if (++visited > MAX_TREE_ENTRIES) return;
      const entryRelative = relative === "" ? name : `${relative}/${name}`;
      const stats = lstatSync(path.join(directory, name));
      if (stats.isSymbolicLink()) {
        collector.add("PROJECT_SYMLINK", `${label}/${entryRelative}`, "links are not allowed in a canonical benchmark project.");
        continue;
      }
      if (stats.isDirectory()) {
        directories.add(entryRelative);
        if (AGENT_SUCCESS_CORPUS_FORBIDDEN_DIRECTORIES.includes(name)) {
          collector.add("PROJECT_FORBIDDEN_OUTPUT", `${label}/${entryRelative}`, "generated or tool output is not allowed in a canonical benchmark project.");
          continue;
        }
        visit(entryRelative);
      } else if (stats.isFile()) {
        files.add(entryRelative);
        if (TEST_NAMING_PATTERN.test(name)) {
          collector.add("PROJECT_TEST_NAMING", `${label}/${entryRelative}`, "benchmark checks must be named *.check.mjs so root test discovery never runs them.");
        }
      } else {
        collector.add("PROJECT_SYMLINK", `${label}/${entryRelative}`, "only regular files and directories are allowed.");
      }
    }
  };
  visit("");
  if (visited > MAX_TREE_ENTRIES) collector.add("PROJECT_TREE_TOO_LARGE", label, `the project has more than ${MAX_TREE_ENTRIES} entries.`);
  return { files, directories };
}

function checkProjectMetadata(collector: Collector, projectRoot: string, label: string): void {
  try {
    const metadata = JSON.parse(readFileSync(path.join(projectRoot, "package.json"), "utf8")) as Record<string, unknown>;
    const engines = metadata.engines as Record<string, unknown> | undefined;
    const problems: string[] = [];
    if (metadata.private !== true) problems.push("private must be true");
    if (metadata.type !== "module") problems.push('type must be "module"');
    if (engines?.node !== ">=24") problems.push('engines.node must be ">=24"');
    if (metadata.dependencies !== undefined || metadata.devDependencies !== undefined) problems.push("the project must be dependency-free");
    if (problems.length > 0) collector.add("PROJECT_METADATA_INVALID", `${label}/package.json`, `${problems.join("; ")}.`);
  } catch {
    collector.add("PROJECT_METADATA_INVALID", `${label}/package.json`, "package.json is missing or not valid JSON.");
  }
}

function checkProject(
  collector: Collector,
  projectsRoot: string | null,
  rootDir: string,
  profile: AgentSuccessProjectProfileV1,
  tasks: readonly AgentSuccessTaskV1[]
): void {
  const label = profile.rootPath;
  const absolute = path.join(rootDir, ...label.split("/"));
  const physical = realDirectory(absolute);
  if (projectsRoot === null || physical === null || !isInside(projectsRoot, physical)) {
    collector.add("PROJECT_ROOT_UNSAFE", label, "the project root must be a real directory inside the controlled benchmark projects directory.");
    return;
  }
  const { files, directories } = walkProject(collector, physical, label);
  const required = AGENT_SUCCESS_CORPUS_PROJECT_FILES[profile.projectId as AgentSuccessCorpusProjectId] ?? [];
  for (const file of required) {
    if (!files.has(file)) collector.add("PROJECT_FILE_MISSING", `${label}/${file}`, "a required project file is missing.");
  }
  for (const root of [...profile.sourceRoots, ...profile.testRoots]) {
    if (!directories.has(root)) collector.add("PROJECT_SCOPE_MISSING", `${label}/${root}`, "a declared source or test root is missing.");
  }
  checkProjectMetadata(collector, physical, label);

  for (const task of tasks.filter((candidate) => candidate.benchmarkProject === profile.projectId)) {
    const referenced = [
      ...task.expectedEditFiles,
      ...task.allowedEditFiles,
      ...task.protectedFiles,
      ...[...task.taskChecks, ...task.regressionChecks].map((check) => check.args[1] ?? "")
    ];
    for (const file of new Set(referenced)) {
      if (!files.has(file)) collector.add("PROJECT_FILE_MISSING", `${task.id}:${file}`, "a file referenced by the task does not exist in the project.");
    }
  }
}

/**
 * Reads the dedicated agent-success task and project-profile catalogs from `rootDir`, validates their structure,
 * and checks that the referenced canonical projects exist on disk with the expected layout. Synchronous because
 * `scripts/verify-benchmarks.ts` is synchronous. It never executes a check or a reference patch and never writes.
 */
export function readAgentSuccessCorpus(rootDir: string): AgentSuccessCorpusReadResult {
  const collector = new Collector();
  const profiles = readCatalog(collector, rootDir, AGENT_SUCCESS_PROJECT_PROFILES_PATH);
  const tasks = readCatalog(collector, rootDir, AGENT_SUCCESS_TASK_CATALOG_PATH);
  if (!profiles.found || !tasks.found) return { ok: false, issues: collector.issues };

  const structural = validateAgentSuccessCorpus({ profiles: profiles.value, tasks: tasks.value });
  if (!structural.ok) return { ok: false, issues: structural.issues };

  const projectsRoot = realDirectory(path.join(rootDir, ...AGENT_SUCCESS_PROJECTS_DIRECTORY.split("/")));
  for (const profile of structural.corpus.profiles) {
    checkProject(collector, projectsRoot, rootDir, profile, structural.corpus.tasks);
  }
  if (collector.issues.length > 0) return { ok: false, issues: collector.issues };
  return { ok: true, corpus: structural.corpus };
}

export function assertReadAgentSuccessCorpus(rootDir: string): AgentSuccessCorpusV1 {
  const result = readAgentSuccessCorpus(rootDir);
  if (!result.ok) throw new AgentSuccessCorpusError(result.issues);
  return result.corpus;
}
