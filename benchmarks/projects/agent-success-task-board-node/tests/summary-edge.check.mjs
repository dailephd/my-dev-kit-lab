import assert from "node:assert/strict";
import test from "node:test";
import { INVALID_PROJECT, createTaskBoard } from "../src/index.js";

test("a project's completed count never exceeds its total", () => {
  const { service, summarize } = createTaskBoard();
  service.createTask({ title: "Solo", projectId: "alpha" });
  for (const title of ["x", "y", "z"]) {
    const task = service.createTask({ title, projectId: "beta" });
    service.completeTask(task.id);
  }
  const summary = summarize("alpha");
  assert.equal(summary.total, 1);
  assert.equal(summary.completed, 0);
  assert.ok(summary.completed <= summary.total);
  assert.equal(summary.open, 1);
});

test("unrelated tasks in the store do not change a project's summary", () => {
  const { service, summarize } = createTaskBoard();
  const a = service.createTask({ title: "A", projectId: "core" });
  service.createTask({ title: "B", projectId: "core" });
  service.completeTask(a.id);
  const before = summarize("core");
  const noise = service.createTask({ title: "Noise", projectId: "core-extras" });
  service.createTask({ title: "More noise", projectId: "CORE2" });
  service.completeTask(noise.id);
  service.importTasks([{ externalId: "n-1", title: "Imported noise", projectId: "c" }]);
  assert.deepEqual(summarize("core"), before);
});

test("an unknown project has an empty, consistent summary", () => {
  const { service, summarize } = createTaskBoard();
  service.createTask({ title: "A", projectId: "known" });
  assert.deepEqual(summarize("missing"), { projectId: "missing", total: 0, completed: 0, open: 0, taskIds: [] });
});

test("blank project identities are rejected consistently", () => {
  const { service, store, summarize } = createTaskBoard();
  assert.throws(() => service.createTask({ title: "Task", projectId: "   " }), { code: INVALID_PROJECT });
  assert.throws(() => service.createTask({ title: "Task", projectId: "" }), { code: INVALID_PROJECT });
  assert.throws(
    () => service.importTasks([{ externalId: "ext-1", title: "Task", projectId: " " }]),
    { code: INVALID_PROJECT }
  );
  assert.throws(() => summarize("  "), { code: INVALID_PROJECT });
  assert.equal(store.list().length, 0);
});

test("summaries are deterministic and list ids in creation order", () => {
  const build = () => {
    const { service, summarize } = createTaskBoard();
    service.createTask({ title: "1", projectId: "p" });
    service.createTask({ title: "2", projectId: "q" });
    service.createTask({ title: "3", projectId: "P" });
    service.importTasks([{ externalId: "e-1", title: "4", projectId: "p " }]);
    return summarize("p");
  };
  assert.deepEqual(build(), build());
  assert.deepEqual(build().taskIds, ["task-1", "task-3", "task-4"]);
});

test("the default project is used for tasks created without one", () => {
  const { service, summarize } = createTaskBoard();
  service.createTask({ title: "No project given" });
  assert.equal(summarize("inbox").total, 1);
});
