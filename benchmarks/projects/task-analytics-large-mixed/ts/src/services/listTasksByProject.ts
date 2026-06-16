import type { AnalyticsTask } from "../models/task.js";
import { AnalyticsTaskStore } from "../store/taskStore.js";

export function listTasksByProject(taskStore: AnalyticsTaskStore, projectId: string): AnalyticsTask[] {
  return taskStore.list().filter((task) => task.projectId === projectId);
}
