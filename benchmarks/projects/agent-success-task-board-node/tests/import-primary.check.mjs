import assert from "node:assert/strict";
import test from "node:test";
import { createTaskBoard } from "../src/index.js";

test("reimporting the same external task does not create a duplicate", () => {
  const { service, store } = createTaskBoard();
  service.importTasks([{ externalId: "ext-1", title: "Alpha", projectId: "ops" }]);
  const second = service.importTasks([{ externalId: "ext-1", title: "Alpha", projectId: "ops" }]);
  assert.equal(second.imported.length, 0);
  assert.equal(store.list().length, 1);
});

test("external identifiers are compared after normalization across import calls", () => {
  const { service, store } = createTaskBoard();
  service.importTasks([{ externalId: "EXT-7", title: "Alpha", projectId: "ops" }]);
  const second = service.importTasks([
    { externalId: "  ext-7  ", title: "Alpha again", projectId: "ops" },
    { externalId: "Ext-7", title: "Alpha once more", projectId: "ops" }
  ]);
  assert.equal(second.imported.length, 0);
  assert.equal(second.skipped.length, 2);
  assert.equal(store.list().length, 1);
});

test("new distinct external identifiers remain importable", () => {
  const { service, store } = createTaskBoard();
  service.importTasks([{ externalId: "ext-1", title: "Alpha", projectId: "ops" }]);
  const second = service.importTasks([{ externalId: "EXT-2", title: "Beta", projectId: "ops" }]);
  assert.equal(second.imported.length, 1);
  assert.equal(store.list().length, 2);
});
