import { describe, expect, it } from "vitest";
import { ProjectStore } from "../src/store/projectStore.js";
import { AnalyticsTaskStore } from "../src/store/taskStore.js";
import { createTask } from "../src/services/createTask.js";

describe("createTask", () => {
  it("creates deterministic ids and validates projects", () => {
    const projectStore = new ProjectStore([{ id: "alpha", name: "Alpha", owner: "Ada" }]);
    const taskStore = new AnalyticsTaskStore();
    expect(
      createTask(taskStore, projectStore, {
        title: "Ship metrics",
        projectId: "alpha",
        assignee: "Lee",
        storyPoints: 5,
        updatedDay: 2,
        labels: ["Metrics"]
      }).id
    ).toBe("task-1");
    expect(() =>
      createTask(taskStore, projectStore, {
        title: "Ship metrics",
        projectId: "missing",
        assignee: "Lee",
        storyPoints: 5,
        updatedDay: 2,
        labels: []
      })
    ).toThrow("Unknown project id: missing");
  });
});
