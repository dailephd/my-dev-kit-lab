import type { TaskFilter, WorkflowTask } from "../models/task.js";
import { TaskWorkflowStore } from "../store/taskStore.js";

export function filterTasks(store: TaskWorkflowStore, filter: TaskFilter): WorkflowTask[] {
  const query = filter.query?.trim().toLowerCase();
  return store.listTasks().filter((task) => {
    if (filter.projectId && task.projectId !== filter.projectId) return false;
    if (filter.completed !== undefined && task.completed !== filter.completed) return false;
    if (filter.priority && task.priority !== filter.priority) return false;
    if (filter.tag && !task.tags.includes(filter.tag.trim().toLowerCase())) return false;
    if (query) {
      const haystack = `${task.title} ${task.notes} ${task.tags.join(" ")}`.toLowerCase();
      if (!haystack.includes(query)) return false;
    }
    return true;
  });
}
