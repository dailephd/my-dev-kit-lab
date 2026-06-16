import { describe, expect, it } from "vitest";
import { createTask } from "../src/services/createTask.js";
import { TaskWorkflowStore } from "../src/store/taskStore.js";

describe("createTask", () => {
  it("creates deterministic task ids inside known projects", () => {
    const store = new TaskWorkflowStore({
      projects: [{ id: "alpha", name: "Alpha", slug: "alpha", archived: false }]
    });
    expect(createTask(store, { title: "Ship report", projectId: "alpha" }).id).toBe("task-1");
    expect(createTask(store, { title: "Review notes", projectId: "alpha" }).id).toBe("task-2");
  });

  it("rejects blank titles and unknown projects", () => {
    const store = new TaskWorkflowStore({
      projects: [{ id: "alpha", name: "Alpha", slug: "alpha", archived: false }]
    });
    expect(() => createTask(store, { title: "   ", projectId: "alpha" })).toThrow("Task title must not be empty.");
    expect(() => createTask(store, { title: "Ready", projectId: "missing" })).toThrow("Unknown project id: missing");
  });
});
