import assert from "node:assert/strict";
import test from "node:test";
import { INVALID_TITLE, ValidationError, createTaskBoard } from "../src/index.js";

test("createTask trims surrounding whitespace from the title", () => {
  const { service } = createTaskBoard();
  const task = service.createTask({ title: "  Write release notes  " });
  assert.equal(task.title, "Write release notes");
});

test("the stored task retains the normalized title", () => {
  const { service, store } = createTaskBoard();
  const task = service.createTask({ title: "\tReview backlog " });
  assert.equal(store.get(task.id).title, "Review backlog");
  assert.deepEqual(
    store.list().map((entry) => entry.title),
    ["Review backlog"]
  );
});

test("a whitespace-only title is rejected with the invalid-title error", () => {
  const { service } = createTaskBoard();
  for (const title of ["   ", "\t", "\n  \r\n"]) {
    assert.throws(
      () => service.createTask({ title }),
      (error) => error instanceof ValidationError && error.code === INVALID_TITLE
    );
  }
});
