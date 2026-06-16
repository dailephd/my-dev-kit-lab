import { describe, expect, it } from "vitest";
import { ProjectStore } from "../src/store/projectStore.js";
import { AnalyticsTaskStore } from "../src/store/taskStore.js";
import { createTask } from "../src/services/createTask.js";
import { listTasksByProject } from "../src/services/listTasksByProject.js";

describe("listTasksByProject", () => {
  it("returns only tasks for the requested project", () => {
    const projectStore = new ProjectStore([
      { id: "alpha", name: "Alpha", owner: "Ada" },
      { id: "beta", name: "Beta", owner: "Bo" }
    ]);
    const taskStore = new AnalyticsTaskStore();
    createTask(taskStore, projectStore, { title: "One", projectId: "alpha", assignee: "A", storyPoints: 2, updatedDay: 1, labels: [] });
    createTask(taskStore, projectStore, { title: "Two", projectId: "beta", assignee: "B", storyPoints: 3, updatedDay: 1, labels: [] });
    expect(listTasksByProject(taskStore, "alpha").map((task) => task.title)).toEqual(["One"]);
  });
});
