import assert from "node:assert/strict";
import test from "node:test";
import { createTaskBoard } from "../src/index.js";

test("tasks created with differently written project names share one project identity", () => {
  const { service, store, summarize } = createTaskBoard();
  service.createTask({ title: "One", projectId: "web" });
  service.createTask({ title: "Two", projectId: "  WEB " });
  service.createTask({ title: "Three", projectId: "Web" });
  assert.deepEqual(
    store.list().map((task) => task.projectId),
    ["web", "web", "web"]
  );
  const summary = summarize("web");
  assert.equal(summary.projectId, "web");
  assert.equal(summary.total, 3);
});

test("a summary only counts tasks of the requested project", () => {
  const { service, summarize } = createTaskBoard();
  const web = service.createTask({ title: "Web task", projectId: "web" });
  service.createTask({ title: "Web app task", projectId: "web-app" });
  service.createTask({ title: "Webhook task", projectId: "webhooks" });
  const other = service.createTask({ title: "Docs task", projectId: "docs" });
  service.completeTask(other.id);
  const summary = summarize("web");
  assert.equal(summary.total, 1);
  assert.equal(summary.completed, 0);
  assert.equal(summary.open, 1);
  assert.deepEqual(summary.taskIds, [web.id]);
});

test("completed and open counts are correct for the requested project", () => {
  const { service, summarize } = createTaskBoard();
  const a = service.createTask({ title: "A", projectId: "ops" });
  service.createTask({ title: "B", projectId: "ops" });
  service.createTask({ title: "C", projectId: "ops" });
  service.createTask({ title: "Elsewhere", projectId: "labs" });
  service.completeTask(a.id);
  assert.deepEqual(summarize(" OPS "), {
    projectId: "ops",
    total: 3,
    completed: 1,
    open: 2,
    taskIds: ["task-1", "task-2", "task-3"]
  });
});

test("imported tasks join the same normalized project identity", () => {
  const { service, summarize } = createTaskBoard();
  service.createTask({ title: "Manual", projectId: "ops" });
  service.importTasks([{ externalId: "ext-1", title: "Imported", projectId: " OPS" }]);
  assert.equal(summarize("ops").total, 2);
});
