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
