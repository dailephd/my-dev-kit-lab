import assert from "node:assert/strict";
import test from "node:test";
import { INVALID_TITLE, ValidationError, createTaskBoard, validateTitle } from "../src/index.js";

test("rejected titles leave the store and id sequence untouched", () => {
  const { service, store } = createTaskBoard();
  assert.throws(() => service.createTask({ title: "  \t " }), { code: INVALID_TITLE });
  assert.throws(() => service.createTask({ title: "" }), { code: INVALID_TITLE });
  assert.equal(store.list().length, 0);
  const task = service.createTask({ title: "First" });
  assert.equal(task.id, "task-1");
  assert.equal(store.list().length, 1);
});

test("interior whitespace is preserved while surrounding whitespace is removed", () => {
  const { service } = createTaskBoard();
  assert.equal(service.createTask({ title: "  Fix  the   bug " }).title, "Fix  the   bug");
  assert.equal(service.createTask({ title: "\n\tPlan sprint\t\n" }).title, "Plan sprint");
});

test("already-trimmed titles keep their meaning", () => {
  const { service } = createTaskBoard();
  assert.equal(service.createTask({ title: "Ship it" }).title, "Ship it");
  assert.equal(service.createTask({ title: "a" }).title, "a");
});

test("validateTitle returns the normalized title and throws the documented error", () => {
  assert.equal(validateTitle("  Triage  "), "Triage");
  assert.throws(
    () => validateTitle("   "),
    (error) => error instanceof ValidationError && error.code === INVALID_TITLE
  );
});

test("imported task titles are normalized the same way", () => {
  const { service } = createTaskBoard();
  const { imported } = service.importTasks([{ externalId: "ext-1", title: "  Imported item  " }]);
  assert.equal(imported[0].title, "Imported item");
});
