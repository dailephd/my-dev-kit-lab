import type { AnalyticsTask } from "../models/task.js";
import { ProjectStore } from "../store/projectStore.js";
import { AnalyticsTaskStore } from "../store/taskStore.js";
import { assertKnownProject } from "../validation/projectValidation.js";
import { normalizeLabels, validateStoryPoints, validateTaskTitle } from "../validation/taskValidation.js";

export function createTask(
  taskStore: AnalyticsTaskStore,
  projectStore: ProjectStore,
  input: Omit<AnalyticsTask, "id" | "completed"> & { completed?: boolean }
): AnalyticsTask {
  return taskStore.create({
    title: validateTaskTitle(input.title),
    projectId: assertKnownProject(projectStore, input.projectId),
    assignee: input.assignee.trim(),
    completed: input.completed ?? false,
    storyPoints: validateStoryPoints(input.storyPoints),
    updatedDay: input.updatedDay,
    labels: normalizeLabels(input.labels)
  });
}
