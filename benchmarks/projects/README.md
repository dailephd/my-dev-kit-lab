# Benchmark Projects

This directory contains deterministic benchmark projects used by my-dev-kit-lab.

The current suite mixes baseline Todo fixtures with more complex workflow and analytics projects:

- `todo-ts`
- `todo-js`
- `todo-python`
- `todo-mixed-ts-py`
- `task-workflow-medium-ts`
- `task-analytics-large-mixed`

The Todo fixtures stay intentionally small so validation and smoke experiments remain cheap. The newer medium and large projects are intentionally more connected so raw full-file context and guided retrieval diverge more meaningfully.

Benchmark project profiles live in `benchmarks/contracts/benchmark-project-profiles.json`.

Each profile records:

- project identity and description
- language mix and primary language
- source roots and test roots
- deterministic file-tree metadata
- complexity metrics and complexity score
- benchmark purpose and expected use cases

Current complexity levels:

- `todo-ts`: small
- `todo-js`: small
- `todo-python`: small
- `todo-mixed-ts-py`: mixed-language
- `task-workflow-medium-ts`: medium
- `task-analytics-large-mixed`: large
