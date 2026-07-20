# Todo Core Benchmark Behavior

Purpose:

This benchmark defines a small, deterministic Todo Core program used for retrieval, benchmark, and later evaluation workflows in my-dev-kit-lab.

These projects are small by design so they are cheap to index, test, compare, and use in future raw full-file versus retrieved-context experiments.

Shared task shape:

- `id: string`
- `title: string`
- `completed: boolean`

Required operations:

- `createTask(title)`
- `completeTask(id)`
- `listTasks()`
- `listOpenTasks()`
- `summarizeTasks()`

Expected validation behavior:

- `createTask` must reject empty or whitespace-only titles
- validation failure must raise a clear error

Expected deterministic ID behavior:

- IDs must be deterministic for a fresh in-memory store
- the first created task must use `task-1`
- the second created task must use `task-2`

Required test coverage:

- create task
- complete task
- list all tasks
- list open tasks
- summarize task counts
- validate empty task title
- deterministic IDs

Benchmark purpose:

The benchmark exists to keep multiple language layouts behaviorally aligned so later prompts can compare retrieval and evaluation approaches without changing the underlying task semantics.

Project profile metadata:

- project profiles live in `benchmarks/contracts/benchmark-project-profiles.json`
- every profile names the benchmark project, language mix, primary language, source roots, test roots, compact file tree, benchmark purpose, expected use cases, complexity metrics, complexity score, and scoring formula
- file-tree entries use relative paths and include source, test, README, package, and config files
- file-tree entries must exclude generated or external folders such as `node_modules`, `dist`, `build`, `coverage`, `lab-output`, `.git`, and interpreter caches

Project complexity formula:

- `projectComplexityScore` ranges from 0 to 100
- every value is normalized as `min(value / cap, 1)`
- formula: `100 * ((0.20 * normalizedSourceFileCount) + (0.20 * normalizedSourceLinesOfCode) + (0.15 * normalizedLanguageCount) + (0.15 * normalizedInternalImportCount) + (0.10 * normalizedMaxFileLines) + (0.10 * normalizedExpectedRelevantFilesAverage) + (0.10 * normalizedExpectedRelevantSymbolsAverage))`
- caps are `sourceFileCount: 20`, `sourceLinesOfCode: 2000`, `languageCount: 4`, `internalImportCount: 50`, `maxFileLines: 300`, `expectedRelevantFilesAverage: 10`, and `expectedRelevantSymbolsAverage: 20`
- the final score is rounded to the nearest integer

Answer key requirements:

- every benchmark case must include `answerKey`
- `answerKey.expectedFiles` lists files a correct answer may need to cite
- `answerKey.expectedSymbols` lists relevant symbols
- `answerKey.expectedFacts` lists weighted facts with unique `id`, `text`, `weight`, and `required`
- `answerKey.minimumCorrectFacts` defines the required-fact threshold used by deterministic correctness scoring
- optional `forbiddenWrongClaims` records claims that should be penalized by a later correctness scorer
