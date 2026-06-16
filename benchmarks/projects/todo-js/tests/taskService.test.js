import { describe, expect, it } from "vitest";
import { TaskService } from "../src/taskService.js";

describe("todo-js TaskService", () => {
  it("creates tasks with deterministic ids", () => {
    const service = new TaskService();
    expect(service.createTask("First").id).toBe("task-1");
    expect(service.createTask("Second").id).toBe("task-2");
  });

  it("completes tasks", () => {
    const service = new TaskService();
    const created = service.createTask("Ship benchmark");
    const completed = service.completeTask(created.id);
    expect(completed.completed).toBe(true);
  });

  it("lists all tasks", () => {
    const service = new TaskService();
    service.createTask("One");
    service.createTask("Two");
    expect(service.listTasks()).toHaveLength(2);
  });

  it("lists open tasks", () => {
    const service = new TaskService();
    const one = service.createTask("One");
    service.createTask("Two");
    service.completeTask(one.id);
    expect(service.listOpenTasks().map((task) => task.title)).toEqual(["Two"]);
  });

  it("summarizes task counts", () => {
    const service = new TaskService();
    const one = service.createTask("One");
    service.createTask("Two");
    service.completeTask(one.id);
    expect(service.summarizeTasks()).toEqual({ total: 2, open: 1, completed: 1 });
  });

  it("rejects empty task titles", () => {
    const service = new TaskService();
    expect(() => service.createTask("   ")).toThrowError("Task title must not be empty.");
  });
});
