import type { AnalyticsTask } from "../models/task.js";

export class AnalyticsTaskStore {
  private nextSequence = 1;
  private readonly tasks = new Map<string, AnalyticsTask>();

  constructor(seed: AnalyticsTask[] = []) {
    for (const task of seed) {
      this.tasks.set(task.id, { ...task, labels: [...task.labels] });
      this.nextSequence = Math.max(this.nextSequence, sequenceFromId(task.id) + 1);
    }
  }

  create(input: Omit<AnalyticsTask, "id">): AnalyticsTask {
    const task: AnalyticsTask = {
      ...input,
      id: `task-${this.nextSequence++}`,
      labels: [...input.labels]
    };
    this.tasks.set(task.id, task);
    return { ...task, labels: [...task.labels] };
  }

  update(taskId: string, updater: (task: AnalyticsTask) => AnalyticsTask): AnalyticsTask {
    const task = this.tasks.get(taskId);
    if (!task) {
      throw new Error(`Unknown task id: ${taskId}`);
    }
    const updated = updater({ ...task, labels: [...task.labels] });
    this.tasks.set(taskId, { ...updated, labels: [...updated.labels] });
    return { ...updated, labels: [...updated.labels] };
  }

  list(): AnalyticsTask[] {
    return [...this.tasks.values()]
      .map((task) => ({ ...task, labels: [...task.labels] }))
      .sort((left, right) => left.id.localeCompare(right.id));
  }
}

function sequenceFromId(id: string): number {
  const match = id.match(/-(\d+)$/);
  return match ? Number(match[1]) : 0;
}
