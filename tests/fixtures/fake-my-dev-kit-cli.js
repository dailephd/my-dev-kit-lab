#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

function argValue(flag) {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function benchmarkProjectFromIndexPath(indexPath) {
  const normalized = String(indexPath || "").replace(/\\/g, "/");
  if (normalized.includes("todo-ts")) return "todo-ts";
  if (normalized.includes("todo-python")) return "todo-python";
  if (normalized.includes("todo-js")) return "todo-js";
  if (normalized.includes("todo-mixed-ts-py")) return "todo-mixed-ts-py";
  return "unknown";
}

const command = process.argv[2];
if (command === "index") {
  const outDir = argValue("--out");
  if (outDir) {
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, "fake-index.json"), JSON.stringify({ ok: true }));
  }
  console.log(JSON.stringify({ ok: true, command: "index", outDir }));
  process.exit(0);
}

if (command === "search") {
  const indexPath = argValue("--index");
  const project = benchmarkProjectFromIndexPath(indexPath);
  const mapping = {
    "todo-ts": { nodeId: "todo-ts:createTask", file: "src/taskService.ts", symbol: "createTask" },
    "todo-python": { nodeId: "todo-python:complete_task", file: "src/task_service.py", symbol: "complete_task" },
    "todo-js": { nodeId: "todo-js:listOpenTasks", file: "src/taskService.js", symbol: "listOpenTasks" },
    "todo-mixed-ts-py": { nodeId: "todo-mixed:summarize_tasks", file: "python/task_service.py", symbol: "summarize_tasks" }
  };
  console.log(JSON.stringify({ results: [mapping[project] || { nodeId: "unknown", file: "unknown", symbol: "unknown" }] }));
  process.exit(0);
}

if (command === "lookup") {
  const node = argValue("--node");
  console.log(JSON.stringify({ nodeId: node, summary: `lookup for ${node}` }));
  process.exit(0);
}

if (command === "slice") {
  const node = argValue("--node");
  console.log(JSON.stringify({ nodeId: node, slice: `slice for ${node}` }));
  process.exit(0);
}

if (command === "source") {
  const node = argValue("--node");
  const sourceMap = {
    "todo-ts:createTask": "1 export class TaskService {\n2   createTask(title: string) {\n3     return this.store.create(title.trim());\n4   }\n5 }",
    "todo-python:complete_task": "1 class TaskService:\n2     def complete_task(self, task_id: str) -> dict:\n3         return self._store.update(task_id, lambda task: {**task, 'completed': True})",
    "todo-js:listOpenTasks": "1 export class TaskService {\n2   listOpenTasks() {\n3     return this.store.list().filter((task) => !task.completed);\n4   }\n5 }",
    "todo-mixed:summarize_tasks": "1 def summarize_tasks(self) -> dict:\n2     completed = len([task for task in self._tasks if task['completed']])\n3     return {'total': len(self._tasks), 'open': len(self._tasks) - completed, 'completed': completed}"
  };
  process.stdout.write(sourceMap[node] || `1 source for ${node}`);
  process.exit(0);
}

process.stderr.write(`Unsupported fake my-dev-kit command: ${command}`);
process.exit(1);
