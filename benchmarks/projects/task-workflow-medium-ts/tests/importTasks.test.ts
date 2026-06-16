import { describe, expect, it } from "vitest";
import { importTasks } from "../src/services/importTasks.js";
import { TaskWorkflowStore } from "../src/store/taskStore.js";

describe("importTasks", () => {
  it("imports tasks with deterministic ids and skips duplicate normalized titles inside the same project", () => {
    const store = new TaskWorkflowStore({
      projects: [{ id: "alpha", name: "Alpha", slug: "alpha", archived: false }]
    });
    const result = importTasks(
      store,
      [
        { title: "Ship report", projectId: "alpha", tags: ["Docs"] },
        { title: "  Ship   report ", projectId: "alpha", tags: ["docs"] },
        { title: "Audit metrics", projectId: "alpha", priority: "high" }
      ],
      "csv"
    );
    expect(result.imported.map((task) => task.id)).toEqual(["task-1", "task-2"]);
    expect(result.skippedDuplicates).toEqual(["task-1"]);
  });
});
