import { TaskNotFoundError, normalizeExternalId } from "./taskStore.js";
import { INVALID_EXTERNAL_ID, ValidationError, validateTitle } from "./validation.js";

const DEFAULT_PROJECT = "inbox";

export class TaskService {
  constructor(store) {
    this.store = store;
  }

  createTask({ title, projectId = DEFAULT_PROJECT } = {}) {
    const normalizedTitle = validateTitle(title);
    return this.store.add({
      id: this.store.nextId(),
      title: normalizedTitle,
      projectId,
      externalId: null,
      completed: false
    });
  }

  completeTask(id) {
    if (!this.store.get(id)) {
      throw new TaskNotFoundError(id);
    }
    return this.store.update(id, { completed: true });
  }

  /**
   * Imports external tasks in input order. Returns the tasks that were created and the
   * external identifiers that were skipped because the task was already imported.
   */
  importTasks(items) {
    const imported = [];
    const skipped = [];
    for (const item of items) {
      if (typeof item?.externalId !== "string" || item.externalId.trim() === "") {
        throw new ValidationError(INVALID_EXTERNAL_ID, "external id must be a non-empty string");
      }
      const externalId = normalizeExternalId(item.externalId);
      if (this.store.findByExternalId(item.externalId)) {
        skipped.push(externalId);
        continue;
      }
      const title = validateTitle(item.title);
      imported.push(
        this.store.add({
          id: this.store.nextId(),
          title,
          projectId: item.projectId ?? DEFAULT_PROJECT,
          externalId,
          completed: false
        })
      );
    }
    return { imported, skipped };
  }
}
