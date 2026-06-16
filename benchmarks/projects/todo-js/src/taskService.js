import { TaskStore } from "./taskStore.js";

export class TaskService {
  constructor(store = new TaskStore()) {
    this.store = store;
  }

  createTask(title) {
    const normalized = title.trim();
    if (!normalized) {
      throw new Error("Task title must not be empty.");
    }
    return this.store.create(normalized);
  }

  completeTask(id) {
    return this.store.update(id, (task) => ({ ...task, completed: true }));
  }

  listTasks() {
    return this.store.list();
  }

  listOpenTasks() {
    return this.store.list().filter((task) => !task.completed);
  }

  summarizeTasks() {
    const tasks = this.store.list();
    const completed = tasks.filter((task) => task.completed).length;
    return {
      total: tasks.length,
      open: tasks.length - completed,
      completed
    };
  }
}
