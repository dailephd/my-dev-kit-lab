import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolvePythonCommand } from "../../../../src/core/pythonCommand.js";

export type Operation =
  | { type: "createTask"; title: string }
  | { type: "completeTask"; id: string }
  | { type: "listTasks" }
  | { type: "listOpenTasks" }
  | { type: "summarizeTasks" };

export function runTodoScenario(operations: Operation[]) {
  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  const scriptPath = path.resolve(currentDir, "../python/task_service.py");
  const python = resolvePythonCommand();
  const result = spawnSync(python.command, [...python.argsPrefix, scriptPath], {
    input: JSON.stringify({ operations }),
    encoding: "utf8",
    shell: false,
    timeout: 10_000,
    windowsHide: true
  });

  if (result.status !== 0) {
    const details = [
      `command=${python.command}`,
      `args=${JSON.stringify([...python.argsPrefix, scriptPath])}`,
      `status=${String(result.status)}`,
      `signal=${String(result.signal)}`,
      `error=${result.error?.message ?? ""}`,
      `stderr=${result.stderr.trim()}`
    ].join("\n");
    throw new Error(details || "Mixed benchmark Python process failed.");
  }

  return JSON.parse(result.stdout) as { results: unknown[] };
}
