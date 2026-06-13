import type { AnalyticsTask } from "../models/task.js";
import { AnalyticsTaskStore } from "../store/taskStore.js";

export function completeTask(taskStore: AnalyticsTaskStore, taskId: string, updatedDay: number): AnalyticsTask {
  return taskStore.update(taskId, (task) => ({
    ...task,
    completed: true,
    updatedDay
  }));
}
