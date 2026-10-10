import assert from "node:assert/strict";
import test from "node:test";
import {
  INVALID_EXTERNAL_ID,
  INVALID_TITLE,
  TaskNotFoundError,
  createTaskBoard
} from "../src/index.js";

test("createTask stores an open task with a sequential id and a default project", () => {
  const { service, store } = createTaskBoard();
  const first = service.createTask({ title: "First" });
  const second = service.createTask({ title: "Second", projectId: "ops" });
  assert.deepEqual(first, { id: "task-1", title: "First", projectId: "inbox", externalId: null, completed: false });
  assert.equal(second.id, "task-2");
  assert.equal(second.projectId, "ops");
  assert.deepEqual(
    store.list().map((task) => task.id),
    ["task-1", "task-2"]
  );
});

test("missing, non-string and empty titles are rejected with the invalid-title error", () => {
  const { service, store } = createTaskBoard();
  for (const title of [undefined, null, 42, {}, ""]) {
    assert.throws(() => service.createTask({ title }), { code: INVALID_TITLE });
  }
  assert.equal(store.list().length, 0);
});

test("already-trimmed titles are stored unchanged", () => {
  const { service } = createTaskBoard();
  assert.equal(service.createTask({ title: "Plain title" }).title, "Plain title");
});

test("completeTask marks a task completed, is idempotent and rejects unknown ids", () => {
  const { service, store } = createTaskBoard();
  const task = service.createTask({ title: "Finish me" });
  assert.equal(service.completeTask(task.id).completed, true);
  assert.equal(service.completeTask(task.id).completed, true);
  assert.equal(store.get(task.id).completed, true);
  assert.throws(() => service.completeTask("task-99"), (error) => error instanceof TaskNotFoundError);
});

test("returned tasks are copies and cannot mutate the store", () => {
  const { service, store } = createTaskBoard();
  const task = service.createTask({ title: "Immutable" });
  task.title = "Changed";
  store.list()[0].title = "Changed too";
  assert.equal(store.get(task.id).title, "Immutable");
});

test("boards are independent of each other", () => {
  const one = createTaskBoard();
  const two = createTaskBoard();
  one.service.createTask({ title: "Only in one" });
  assert.equal(two.store.list().length, 0);
  assert.equal(two.service.createTask({ title: "Fresh" }).id, "task-1");
});

test("importing the same external identifier twice does not duplicate it", () => {
  const { service, store } = createTaskBoard();
  const first = service.importTasks([{ externalId: "ext-1", title: "Imported", projectId: "ops" }]);
  const second = service.importTasks([{ externalId: "ext-1", title: "Imported", projectId: "ops" }]);
  assert.equal(first.imported.length, 1);
  assert.deepEqual(second, { imported: [], skipped: ["ext-1"] });
  assert.equal(store.list().length, 1);
});

test("distinct external identifiers import in input order and keep manual tasks", () => {
  const { service, store } = createTaskBoard();
  service.createTask({ title: "Manual", projectId: "ops" });
  const { imported } = service.importTasks([
    { externalId: "ext-2", title: "Two", projectId: "ops" },
    { externalId: "ext-1", title: "One", projectId: "ops" }
  ]);
  assert.deepEqual(
    imported.map((task) => task.externalId),
    ["ext-2", "ext-1"]
  );
  assert.deepEqual(
    store.list().map((task) => task.title),
    ["Manual", "Two", "One"]
  );
});

test("imports without a usable external identifier are rejected", () => {
  const { service } = createTaskBoard();
  for (const externalId of [undefined, null, "", "   ", 7]) {
    assert.throws(() => service.importTasks([{ externalId, title: "No id" }]), { code: INVALID_EXTERNAL_ID });
  }
});

test("a single-project summary counts total, completed and open tasks", () => {
  const { service, summarize } = createTaskBoard();
  const a = service.createTask({ title: "A", projectId: "web" });
  service.createTask({ title: "B", projectId: "web" });
  service.createTask({ title: "C", projectId: "web" });
  service.completeTask(a.id);
  assert.deepEqual(summarize("web"), {
    projectId: "web",
    total: 3,
    completed: 1,
    open: 2,
    taskIds: ["task-1", "task-2", "task-3"]
  });
});
