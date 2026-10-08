export class TaskNotFoundError extends Error {
  constructor(id) {
    super(`task not found: ${id}`);
    this.name = "TaskNotFoundError";
    this.code = "TASK_NOT_FOUND";
  }
}

/**
 * Returns the identity key used to compare external task identifiers.
 */
export function normalizeExternalId(externalId) {
  return String(externalId).trim();
}

/**
 * In-memory task storage. Tasks are returned as copies, in insertion order.
 */
export class TaskStore {
  #tasks = [];
  #sequence = 0;

  nextId() {
    this.#sequence += 1;
    return `task-${this.#sequence}`;
  }

  add(task) {
    this.#tasks.push({ ...task });
    return { ...task };
  }

  get(id) {
    const task = this.#tasks.find((candidate) => candidate.id === id);
    return task ? { ...task } : null;
  }

  list() {
    return this.#tasks.map((task) => ({ ...task }));
  }

  update(id, changes) {
    const task = this.#tasks.find((candidate) => candidate.id === id);
    if (!task) {
      throw new TaskNotFoundError(id);
    }
    Object.assign(task, changes);
    return { ...task };
  }

  /**
   * Finds a task by an already-normalized external identifier key.
   */
  findByExternalId(externalId) {
    const task = this.#tasks.find((candidate) => candidate.externalId === externalId);
    return task ? { ...task } : null;
  }
}
