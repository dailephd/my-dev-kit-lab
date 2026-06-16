import type { WorkflowTask } from "../models/task.js";
import { TaskWorkflowStore } from "../store/taskStore.js";

export function completeTask(store: TaskWorkflowStore, taskId: string): WorkflowTask {
  return store.updateTask(taskId, (task) => {
    if (task.completed) {
      return task;
    }
    return {
      ...task,
      completed: true,
      completedAt: "2026-02-01T00:00:00.000Z"
    };
  });
}
