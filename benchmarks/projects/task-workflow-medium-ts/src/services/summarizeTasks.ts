import type { TaskSummary } from "../models/task.js";
import { TaskWorkflowStore } from "../store/taskStore.js";

export function summarizeTasks(store: TaskWorkflowStore): TaskSummary {
  const tasks = store.listTasks();
  const byProject: TaskSummary["byProject"] = {};

  for (const project of store.listProjects()) {
    byProject[project.id] = { total: 0, completed: 0, open: 0 };
  }

  for (const task of tasks) {
    byProject[task.projectId] ??= { total: 0, completed: 0, open: 0 };
    byProject[task.projectId].total += 1;
    if (task.completed) {
      byProject[task.projectId].completed += 1;
    } else {
      byProject[task.projectId].open += 1;
    }
  }

  const completed = tasks.filter((task) => task.completed).length;
  return {
    total: tasks.length,
    completed,
    open: tasks.length - completed,
    byProject,
    highPriorityOpenTitles: tasks.filter((task) => !task.completed && task.priority === "high").map((task) => task.title)
  };
}
