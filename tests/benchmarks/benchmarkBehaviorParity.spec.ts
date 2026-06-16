import { spawnSync } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { TaskService as TsTaskService } from "../../benchmarks/projects/todo-ts/src/taskService.js";
import { runTodoScenario } from "../../benchmarks/projects/todo-mixed-ts-py/src/taskCli.js";

async function loadJsTaskService() {
  const modulePath = path.join(process.cwd(), "benchmarks", "projects", "todo-js", "src", "taskService.js");
  return (await import(pathToFileURL(modulePath).href)).TaskService as new () => {
    createTask(title: string): { id: string; title: string; completed: boolean };
    completeTask(id: string): { id: string; title: string; completed: boolean };
    listTasks(): Array<{ id: string; title: string; completed: boolean }>;
    listOpenTasks(): Array<{ id: string; title: string; completed: boolean }>;
    summarizeTasks(): { total: number; open: number; completed: number };
  };
}

function runPythonSnippet(code: string) {
  const projectDir = path.join(process.cwd(), "benchmarks", "projects", "todo-python");
  return spawnSync("python", ["-c", code], {
    cwd: projectDir,
    encoding: "utf8",
    env: {
      ...process.env,
      PYTHONPATH: path.join(projectDir, "src")
    }
  });
}

describe("benchmark behavior parity", () => {
  it("TypeScript behavior passes", () => {
    const service = new TsTaskService();
    const first = service.createTask("One");
    service.createTask("Two");
    service.completeTask(first.id);
    expect(service.listOpenTasks()).toEqual([{ id: "task-2", title: "Two", completed: false }]);
    expect(service.summarizeTasks()).toEqual({ total: 2, open: 1, completed: 1 });
  });

  it("JavaScript behavior passes", async () => {
    const JsTaskService = await loadJsTaskService();
    const service = new JsTaskService();
    const first = service.createTask("One");
    service.createTask("Two");
    service.completeTask(first.id);
    expect(service.listOpenTasks()).toEqual([{ id: "task-2", title: "Two", completed: false }]);
    expect(service.summarizeTasks()).toEqual({ total: 2, open: 1, completed: 1 });
  });

  it("Python behavior passes through a child process", () => {
    const result = runPythonSnippet(
      [
        "import json",
        "from task_service import TaskService",
        "service = TaskService()",
        "first = service.create_task('One')",
        "service.create_task('Two')",
        "service.complete_task(first['id'])",
        "print(json.dumps({'open': service.list_open_tasks(), 'summary': service.summarize_tasks()}))"
      ].join("; ")
    );
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({
      open: [{ id: "task-2", title: "Two", completed: false }],
      summary: { total: 2, open: 1, completed: 1 }
    });
  });

  it("mixed boundary behavior passes", () => {
    const result = runTodoScenario([
      { type: "createTask", title: "One" },
      { type: "createTask", title: "Two" },
      { type: "completeTask", id: "task-1" },
      { type: "listOpenTasks" },
      { type: "summarizeTasks" }
    ]);
    expect(result.results.at(3)).toEqual([{ id: "task-2", title: "Two", completed: false }]);
    expect(result.results.at(4)).toEqual({ total: 2, open: 1, completed: 1 });
  });
});
