import { describe, expect, it } from "vitest";
import { completeTask } from "../src/services/completeTask.js";
import { createTask } from "../src/services/createTask.js";
import { TaskWorkflowStore } from "../src/store/taskStore.js";

describe("completeTask", () => {
  it("marks only the selected task as completed", () => {
    const store = new TaskWorkflowStore({
      projects: [{ id: "alpha", name: "Alpha", slug: "alpha", archived: false }]
    });
    const first = createTask(store, { title: "One", projectId: "alpha" });
    createTask(store, { title: "Two", projectId: "alpha" });
    expect(completeTask(store, first.id).completed).toBe(true);
    expect(store.listTasks().map((task) => task.completed)).toEqual([true, false]);
  });
});
