export class TaskStore {
  #tasks = [];
  #nextId = 1;

  create(title) {
    const task = {
      id: `task-${this.#nextId++}`,
      title,
      completed: false
    };
    this.#tasks.push(task);
    return { ...task };
  }

  update(taskId, updater) {
    const index = this.#tasks.findIndex((task) => task.id === taskId);
    if (index === -1) {
      throw new Error(`Task not found: ${taskId}`);
    }
    const updated = updater(this.#tasks[index]);
    this.#tasks[index] = updated;
    return { ...updated };
  }

  list() {
    return this.#tasks.map((task) => ({ ...task }));
  }
}
