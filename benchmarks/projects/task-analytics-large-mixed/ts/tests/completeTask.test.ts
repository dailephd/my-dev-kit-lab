import { describe, expect, it } from "vitest";
import { ProjectStore } from "../src/store/projectStore.js";
import { AnalyticsTaskStore } from "../src/store/taskStore.js";
import { completeTask } from "../src/services/completeTask.js";
import { createTask } from "../src/services/createTask.js";

describe("completeTask", () => {
  it("marks a selected task completed and updates its day marker", () => {
    const projectStore = new ProjectStore([{ id: "alpha", name: "Alpha", owner: "Ada" }]);
    const taskStore = new AnalyticsTaskStore();
    const created = createTask(taskStore, projectStore, {
      title: "Ship metrics",
      projectId: "alpha",
      assignee: "Lee",
      storyPoints: 5,
      updatedDay: 2,
      labels: []
    });
    expect(completeTask(taskStore, created.id, 9)).toMatchObject({ completed: true, updatedDay: 9 });
  });
});
