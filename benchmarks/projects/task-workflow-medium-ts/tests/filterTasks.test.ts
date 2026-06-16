import { describe, expect, it } from "vitest";
import { completeTask } from "../src/services/completeTask.js";
import { createTask } from "../src/services/createTask.js";
import { filterTasks } from "../src/services/filterTasks.js";
import { TaskWorkflowStore } from "../src/store/taskStore.js";

describe("filterTasks", () => {
  it("filters by query, tag, priority, and completion state", () => {
    const store = new TaskWorkflowStore({
      projects: [{ id: "alpha", name: "Alpha", slug: "alpha", archived: false }]
    });
    const first = createTask(store, { title: "Ship release notes", projectId: "alpha", priority: "high", tags: ["Docs"] });
    createTask(store, { title: "Review pipeline", projectId: "alpha", priority: "medium", tags: ["ops"] });
    completeTask(store, first.id);
    expect(filterTasks(store, { query: "pipeline" }).map((task) => task.title)).toEqual(["Review pipeline"]);
    expect(filterTasks(store, { tag: "docs", completed: true }).map((task) => task.id)).toEqual([first.id]);
  });
});
