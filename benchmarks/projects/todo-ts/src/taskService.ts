import { TaskStore, type Task } from "./taskStore.js";

export type TaskSummary = {
  total: number;
  open: number;
  completed: number;
};

export class TaskService {
  constructor(private readonly store = new TaskStore()) {}

  createTask(title: string): Task {
    const normalized = title.trim();
    if (!normalized) {
      throw new Error("Task title must not be empty.");
    }
    return this.store.create(normalized);
  }

  completeTask(id: string): Task {
    return this.store.update(id, (task) => ({ ...task, completed: true }));
  }

  listTasks(): Task[] {
    return this.store.list();
  }

  listOpenTasks(): Task[] {
    return this.store.list().filter((task) => !task.completed);
  }

  summarizeTasks(): TaskSummary {
    const tasks = this.store.list();
    const completed = tasks.filter((task) => task.completed).length;
    return {
      total: tasks.length,
      open: tasks.length - completed,
      completed
    };
  }
}
