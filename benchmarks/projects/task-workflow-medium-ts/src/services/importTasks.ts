import type { TaskImportInput, WorkflowTask } from "../models/task.js";
import { TaskWorkflowStore } from "../store/taskStore.js";
import { validateImportInput } from "../validation/taskValidation.js";

export type ImportTasksResult = {
  imported: WorkflowTask[];
  skippedDuplicates: string[];
};

export function importTasks(store: TaskWorkflowStore, items: TaskImportInput[], importSource: string): ImportTasksResult {
  const imported: WorkflowTask[] = [];
  const skippedDuplicates: string[] = [];

  for (const item of items) {
    const validated = validateImportInput(item);
    if (!store.getProject(validated.projectId)) {
      throw new Error(`Unknown project id: ${validated.projectId}`);
    }
    const duplicate = store.findDuplicate(validated);
    if (duplicate) {
      skippedDuplicates.push(duplicate.id);
      continue;
    }
    imported.push(
      store.createTask({
        ...validated,
        importSource
      })
    );
  }

  return { imported, skippedDuplicates };
}
