import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

export type Operation =
  | { type: "createTask"; title: string }
  | { type: "completeTask"; id: string }
  | { type: "listTasks" }
  | { type: "listOpenTasks" }
  | { type: "summarizeTasks" };

export function runTodoScenario(operations: Operation[]) {
  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  const scriptPath = path.resolve(currentDir, "../python/task_service.py");
  const result = spawnSync("python", [scriptPath], {
    input: JSON.stringify({ operations }),
    encoding: "utf8"
  });

  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || "Mixed benchmark Python process failed.");
  }

  return JSON.parse(result.stdout) as { results: unknown[] };
}
