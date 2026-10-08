import assert from "node:assert/strict";
import test from "node:test";
import { createTaskBoard } from "../src/index.js";

test("duplicates inside a single import call are collapsed to the first occurrence", () => {
  const { service, store } = createTaskBoard();
  const result = service.importTasks([
    { externalId: "A-1", title: "First", projectId: "ops" },
    { externalId: " a-1 ", title: "Second", projectId: "ops" },
    { externalId: "b-2", title: "Third", projectId: "ops" }
  ]);
  assert.deepEqual(
    result.imported.map((task) => task.title),
    ["First", "Third"]
  );
  assert.deepEqual(result.skipped, ["a-1"]);
  assert.equal(store.list().length, 2);
});

test("stored external identifiers use one normalized form", () => {
  const { service, store } = createTaskBoard();
  service.importTasks([
    { externalId: "  MiXeD-9 ", title: "Mixed", projectId: "ops" },
    { externalId: "UPPER-1", title: "Upper", projectId: "ops" }
  ]);
  assert.deepEqual(
    store.list().map((task) => task.externalId),
    ["mixed-9", "upper-1"]
  );
});

test("import order is deterministic and ids follow input order", () => {
  const run = () => {
    const { service } = createTaskBoard();
    return service
      .importTasks([
        { externalId: "z-1", title: "Z", projectId: "ops" },
        { externalId: "a-1", title: "A", projectId: "ops" },
        { externalId: "Z-1", title: "Z duplicate", projectId: "ops" }
      ])
      .imported.map((task) => [task.id, task.title, task.externalId]);
  };
  assert.deepEqual(run(), [
    ["task-1", "Z", "z-1"],
    ["task-2", "A", "a-1"]
  ]);
  assert.deepEqual(run(), run());
});

test("manually created tasks are kept and do not block imports", () => {
  const { service, store } = createTaskBoard();
  const manual = service.createTask({ title: "Manual task", projectId: "ops" });
  service.importTasks([{ externalId: "ext-1", title: "Imported", projectId: "ops" }]);
  service.importTasks([{ externalId: "EXT-1", title: "Imported", projectId: "ops" }]);
  const titles = store.list().map((task) => task.title);
  assert.deepEqual(titles, ["Manual task", "Imported"]);
  assert.equal(store.get(manual.id).externalId, null);
});

test("skipped identifiers are reported in normalized form", () => {
  const { service } = createTaskBoard();
  service.importTasks([{ externalId: "ext-5", title: "Five", projectId: "ops" }]);
  const second = service.importTasks([{ externalId: " EXT-5", title: "Five", projectId: "ops" }]);
  assert.deepEqual(second.skipped, ["ext-5"]);
});
