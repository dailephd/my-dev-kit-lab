import type { TaskPriority, WorkflowTask } from "../models/task.js";
import { TaskWorkflowStore } from "../store/taskStore.js";
import { normalizeTags, validatePriority, validateProjectId, validateTaskTitle } from "../validation/taskValidation.js";

export type CreateTaskInput = {
  title: string;
  projectId: string;
  priority?: TaskPriority;
  tags?: string[];
  notes?: string;
};

export function createTask(store: TaskWorkflowStore, input: CreateTaskInput): WorkflowTask {
  const title = validateTaskTitle(input.title);
  const projectId = validateProjectId(input.projectId);
  if (!store.getProject(projectId)) {
    throw new Error(`Unknown project id: ${projectId}`);
  }
  return store.createTask({
    title,
    projectId,
    priority: validatePriority(input.priority),
    tags: normalizeTags(input.tags ?? []),
    notes: input.notes?.trim() ?? ""
  });
}
