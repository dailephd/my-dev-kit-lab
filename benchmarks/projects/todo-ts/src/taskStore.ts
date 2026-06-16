export type Task = {
  id: string;
  title: string;
  completed: boolean;
};

export class TaskStore {
  private tasks: Task[] = [];
  private nextId = 1;

  create(title: string): Task {
    const task: Task = {
      id: `task-${this.nextId++}`,
      title,
      completed: false
    };
    this.tasks.push(task);
    return { ...task };
  }

  update(taskId: string, updater: (task: Task) => Task): Task {
    const index = this.tasks.findIndex((task) => task.id === taskId);
    if (index === -1) {
      throw new Error(`Task not found: ${taskId}`);
    }
    const updated = updater(this.tasks[index]);
    this.tasks[index] = updated;
    return { ...updated };
  }

  list(): Task[] {
    return this.tasks.map((task) => ({ ...task }));
  }
}
