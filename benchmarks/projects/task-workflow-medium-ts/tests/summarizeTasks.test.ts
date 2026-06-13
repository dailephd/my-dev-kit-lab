import { describe, expect, it } from "vitest";
import { completeTask } from "../src/services/completeTask.js";
import { createTask } from "../src/services/createTask.js";
import { summarizeTasks } from "../src/services/summarizeTasks.js";
import { TaskWorkflowStore } from "../src/store/taskStore.js";

describe("summarizeTasks", () => {
  it("reports totals, per-project counts, and high-priority open titles", () => {
    const store = new TaskWorkflowStore({
      projects: [
        { id: "alpha", name: "Alpha", slug: "alpha", archived: false },
        { id: "beta", name: "Beta", slug: "beta", archived: false }
      ]
    });
    const first = createTask(store, { title: "Ship report", projectId: "alpha", priority: "high" });
    createTask(store, { title: "Audit logs", projectId: "beta", priority: "medium" });
    completeTask(store, first.id);
    expect(summarizeTasks(store)).toEqual({
      total: 2,
      completed: 1,
      open: 1,
      byProject: {
        alpha: { total: 1, completed: 1, open: 0 },
        beta: { total: 1, completed: 0, open: 1 }
      },
      highPriorityOpenTitles: []
    });
  });
});
