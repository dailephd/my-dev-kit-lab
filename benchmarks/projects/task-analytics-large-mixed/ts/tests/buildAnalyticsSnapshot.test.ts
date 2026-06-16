import { describe, expect, it } from "vitest";
import { buildAnalyticsSnapshot } from "../src/services/buildAnalyticsSnapshot.js";
import { ProjectStore } from "../src/store/projectStore.js";
import { AnalyticsTaskStore } from "../src/store/taskStore.js";
import { completeTask } from "../src/services/completeTask.js";
import { createTask } from "../src/services/createTask.js";

describe("buildAnalyticsSnapshot", () => {
  it("computes per-project totals, completion rate, and stale counts", () => {
    const projectStore = new ProjectStore([
      { id: "alpha", name: "Alpha", owner: "Ada" },
      { id: "beta", name: "Beta", owner: "Bo" }
    ]);
    const taskStore = new AnalyticsTaskStore();
    const done = createTask(taskStore, projectStore, {
      title: "Ship metrics",
      projectId: "alpha",
      assignee: "Lee",
      storyPoints: 5,
      updatedDay: 2,
      labels: []
    });
    createTask(taskStore, projectStore, {
      title: "Audit backlog",
      projectId: "alpha",
      assignee: "Sam",
      storyPoints: 3,
      updatedDay: 1,
      labels: ["ops"]
    });
    createTask(taskStore, projectStore, {
      title: "Tune report",
      projectId: "beta",
      assignee: "Ira",
      storyPoints: 8,
      updatedDay: 11,
      labels: ["report"]
    });
    completeTask(taskStore, done.id, 8);
    expect(buildAnalyticsSnapshot(taskStore, projectStore, 15)).toMatchObject({
      totals: { totalTasks: 3, completedTasks: 1, openTasks: 2, staleTasks: 1 },
      projects: [
        { projectId: "alpha", totalTasks: 2, completedTasks: 1, openTasks: 1, staleTasks: 1, completionRate: 50 },
        { projectId: "beta", totalTasks: 1, completedTasks: 0, openTasks: 1, staleTasks: 0, completionRate: 0 }
      ]
    });
  });
});
