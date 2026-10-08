# agent-success-task-board-node

A small, dependency-free, in-memory task board written as JavaScript ES modules for Node.js `>=24`.

This project is an **implementation benchmark** for the `agent-success-rate` experiment of
`my-dev-kit-lab`. It is a controlled fixture: the Lab copies it into a disposable sandbox, asks an
implementation to change code under `src/`, and judges the result with trusted checks that the
implementation does not receive. The project is not a product and has no persistence, network access,
environment dependence, randomness or timestamps.

## Behavior

The board models task creation, storage, external-task import, project ownership, completion and
per-project summaries. All state lives in memory inside one board instance; two boards never share state.

- A task has `id`, `title`, `projectId`, `externalId` (`null` for manually created tasks) and `completed`.
- Task ids are sequential per board: `task-1`, `task-2`, ... An operation that is rejected does not
  consume an id and does not change the store.
- A **title** is a non-empty string once surrounding whitespace is removed. Surrounding whitespace is not
  part of the stored title; interior whitespace is kept. Invalid titles fail with a `ValidationError`
  whose `code` is `INVALID_TITLE`.
- A **project identity** is the project id trimmed and lower-cased. Tasks created without a project belong
  to `inbox`. A blank project id fails with a `ValidationError` whose `code` is `INVALID_PROJECT`.
  A project's tasks are exactly the tasks with that identity; other projects, including projects whose
  names merely start with the same text, are unrelated.
- An **external id** identifies a task in an external system. It is compared after trimming and
  lower-casing, and the normalized form is what the board stores. An import without a usable external id
  fails with a `ValidationError` whose `code` is `INVALID_EXTERNAL_ID`.
- **Import** processes items in input order. An item whose external id is already known, from an earlier
  call or earlier in the same call, is skipped instead of creating a duplicate.
- Tasks that were created manually are never removed by imports.
- A **summary** reports one project's `total`, `completed` and `open` counts and the ids of its tasks in
  creation order. `completed` can never exceed `total`, and tasks of other projects never change a
  project's summary.

## Public API

Everything is exported from `src/index.js`.

| Export | Purpose |
| --- | --- |
| `createTaskBoard()` | Returns `{ store, service, summarize }` for a fresh, independent board. |
| `TaskService` | `createTask({ title, projectId? })`, `completeTask(id)`, `importTasks(items)`. |
| `TaskStore` | `nextId()`, `add(task)`, `get(id)`, `list()`, `update(id, changes)`, `findByExternalId(key)`. |
| `summarizeProject(store, projectId)` | Returns `{ projectId, total, completed, open, taskIds }`. |
| `validateTitle(title)` | Returns the normalized title or throws `ValidationError`. |
| `normalizeProjectId(projectId)` | Returns the normalized project identity or throws `ValidationError`. |
| `normalizeExternalId(externalId)` | Returns the identity key used to compare external ids. |
| `ValidationError`, `TaskNotFoundError` | Error classes with a stable `code` property. |
| `INVALID_TITLE`, `INVALID_PROJECT`, `INVALID_EXTERNAL_ID` | Validation error codes. |

`importTasks(items)` takes `{ externalId, title, projectId? }` items and returns
`{ imported, skipped }`: the created tasks, and the normalized external ids that were skipped.

Stores return copies of tasks, so changing a returned object never changes the board.

## Layout

```
src/validation.js       title, project and error contracts
src/taskStore.js        in-memory storage and external-id identity
src/taskService.js      task creation, completion and import
src/projectSummary.js   per-project summaries
src/index.js            public exports and createTaskBoard()
tests/*.check.mjs       trusted verification checks (owned by the Lab verifier)
```

## Running checks

```
npm test
node --test tests/regression.check.mjs
```

The files under `tests/` are named `*.check.mjs` on purpose and are run explicitly through Node's built-in
test runner. They are verification inputs owned by the Lab, not part of the implementation to change.
No installation step is needed.
