import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

type BenchmarkCase = {
  id: string;
  title: string;
  task: string;
  query: string;
  expectedOperation: string;
  expectedSymbols: string[];
  expectedFilesByProject: Record<string, string[]>;
  rawIncludeGlobs: string[];
  notes: string;
};

type ValidationResult = {
  ok: boolean;
  errors: string[];
  checks: string[];
};

const requiredProjects = ["todo-ts", "todo-python", "todo-js", "todo-mixed-ts-py"] as const;
const projectRequiredPaths: Record<(typeof requiredProjects)[number], string[]> = {
  "todo-ts": [
    "README.md",
    "package.json",
    "tsconfig.json",
    "src/taskStore.ts",
    "src/taskService.ts",
    "src/index.ts",
    "tests/taskService.test.ts"
  ],
  "todo-python": [
    "README.md",
    "src/task_store.py",
    "src/task_service.py",
    "src/__init__.py",
    "tests/test_task_service.py"
  ],
  "todo-js": [
    "README.md",
    "package.json",
    "src/taskStore.js",
    "src/taskService.js",
    "src/index.js",
    "tests/taskService.test.js"
  ],
  "todo-mixed-ts-py": [
    "README.md",
    "package.json",
    "tsconfig.json",
    "src/taskCli.ts",
    "python/task_service.py",
    "tests/mixedBoundary.test.ts"
  ]
};

function walk(dir: string): string[] {
  const entries = readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walk(fullPath));
    } else {
      files.push(fullPath);
    }
  }
  return files;
}

export function validateBenchmarks(rootDir = process.cwd()): ValidationResult {
  const checks: string[] = [];
  const errors: string[] = [];
  const contractsDir = path.join(rootDir, "benchmarks", "contracts");
  const projectsDir = path.join(rootDir, "benchmarks", "projects");
  const behaviorPath = path.join(contractsDir, "todo-behavior.md");
  const casesPath = path.join(contractsDir, "todo-benchmark-case.json");

  if (!existsSync(behaviorPath)) {
    errors.push("Missing contract file: benchmarks/contracts/todo-behavior.md");
  } else {
    checks.push("found todo-behavior.md");
  }

  let cases: BenchmarkCase[] = [];
  if (!existsSync(casesPath)) {
    errors.push("Missing contract file: benchmarks/contracts/todo-benchmark-case.json");
  } else {
    try {
      cases = JSON.parse(readFileSync(casesPath, "utf8")) as BenchmarkCase[];
      checks.push("parsed todo-benchmark-case.json");
    } catch (error) {
      errors.push(`Invalid JSON in todo-benchmark-case.json: ${(error as Error).message}`);
    }
  }

  const ids = new Set<string>();
  for (const benchmarkCase of cases) {
    if (ids.has(benchmarkCase.id)) {
      errors.push(`Duplicate benchmark case id: ${benchmarkCase.id}`);
    }
    ids.add(benchmarkCase.id);
  }
  if (cases.length > 0 && errors.every((error) => !error.startsWith("Duplicate benchmark case id:"))) {
    checks.push("benchmark case ids are unique");
  }

  for (const project of requiredProjects) {
    const projectDir = path.join(projectsDir, project);
    if (!existsSync(projectDir) || !statSync(projectDir).isDirectory()) {
      errors.push(`Missing benchmark project: benchmarks/projects/${project}`);
      continue;
    }
    checks.push(`found benchmark project ${project}`);
    for (const relPath of projectRequiredPaths[project]) {
      const fullPath = path.join(projectDir, relPath);
      if (!existsSync(fullPath)) {
        errors.push(`Missing required file for ${project}: benchmarks/projects/${project}/${relPath}`);
      }
    }
  }

  for (const benchmarkCase of cases) {
    for (const project of requiredProjects) {
      const expectedFiles = benchmarkCase.expectedFilesByProject?.[project];
      if (!Array.isArray(expectedFiles) || expectedFiles.length === 0) {
        errors.push(`Case ${benchmarkCase.id} does not define expected files for ${project}`);
        continue;
      }
      for (const expectedFile of expectedFiles) {
        const fullPath = path.join(rootDir, "benchmarks", "projects", project, expectedFile);
        if (!existsSync(fullPath)) {
          errors.push(`Case ${benchmarkCase.id} references missing file: benchmarks/projects/${project}/${expectedFile}`);
        }
      }
    }
  }

  for (const project of requiredProjects) {
    const projectDir = path.join(projectsDir, project);
    if (!existsSync(projectDir)) {
      continue;
    }
    const forbidden = walk(projectDir).filter((fullPath) => {
      const rel = path.relative(projectDir, fullPath).replace(/\\/g, "/");
      return /(^|\/)(node_modules|dist|build|coverage|lab-output)(\/|$)/.test(rel);
    });
    if (forbidden.length > 0) {
      errors.push(`Forbidden generated output found in ${project}: ${forbidden[0]}`);
    }
  }

  return { ok: errors.length === 0, errors, checks };
}

function printSummary(result: ValidationResult): void {
  console.log(`Benchmark verification ${result.ok ? "passed" : "failed"}.`);
  console.log(`Checks: ${result.checks.length}`);
  if (result.errors.length > 0) {
    console.log(`Errors: ${result.errors.length}`);
    for (const error of result.errors) {
      console.log(`- ${error}`);
    }
  }
}

const currentFile = fileURLToPath(import.meta.url);
const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invokedPath === currentFile) {
  const result = validateBenchmarks();
  printSummary(result);
  if (!result.ok) {
    process.exitCode = 1;
  }
}
