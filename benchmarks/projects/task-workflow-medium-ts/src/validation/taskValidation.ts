import type { TaskImportInput, TaskPriority } from "../models/task.js";

const VALID_PRIORITIES = new Set<TaskPriority>(["low", "medium", "high"]);

export function normalizeTaskTitle(title: string): string {
  return title.trim().replace(/\s+/g, " ");
}

export function validateTaskTitle(title: string): string {
  const normalized = normalizeTaskTitle(title);
  if (!normalized) {
    throw new Error("Task title must not be empty.");
  }
  return normalized;
}

export function validateProjectId(projectId: string): string {
  const normalized = projectId.trim();
  if (!normalized) {
    throw new Error("projectId must not be empty.");
  }
  return normalized;
}

export function validatePriority(priority: TaskPriority | undefined): TaskPriority {
  const resolved = priority ?? "medium";
  if (!VALID_PRIORITIES.has(resolved)) {
    throw new Error(`Unsupported priority: ${priority}`);
  }
  return resolved;
}

export function validateImportInput(input: TaskImportInput): Required<TaskImportInput> {
  return {
    title: validateTaskTitle(input.title),
    projectId: validateProjectId(input.projectId),
    priority: validatePriority(input.priority),
    tags: normalizeTags(input.tags ?? []),
    notes: input.notes?.trim() ?? ""
  };
}

export function normalizeTags(tags: string[]): string[] {
  return [...new Set(tags.map((tag) => tag.trim().toLowerCase()).filter(Boolean))].sort();
}
