import { describe, expect, it } from "vitest";
import { runTodoScenario } from "../src/taskCli.js";

describe("todo-mixed-ts-py boundary", () => {
  it("runs deterministic todo behavior through the TypeScript to Python boundary", () => {
    const result = runTodoScenario([
      { type: "createTask", title: "One" },
      { type: "createTask", title: "Two" },
      { type: "completeTask", id: "task-1" },
      { type: "listOpenTasks" },
      { type: "summarizeTasks" }
    ]);

    expect(result.results.at(0)).toEqual({ id: "task-1", title: "One", completed: false });
    expect(result.results.at(3)).toEqual([{ id: "task-2", title: "Two", completed: false }]);
    expect(result.results.at(4)).toEqual({ total: 2, open: 1, completed: 1 });
  });
});
