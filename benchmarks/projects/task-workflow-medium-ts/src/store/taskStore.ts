import { createDeterministicId } from "../utils/deterministicId.js";
import type { WorkflowProject } from "../models/project.js";
import type { TaskImportInput, TaskPriority, WorkflowTask } from "../models/task.js";
import { normalizeTaskTitle, normalizeTags } from "../validation/taskValidation.js";

export class TaskWorkflowStore {
  private nextTaskSequence = 1;
  private readonly projects = new Map<string, WorkflowProject>();
  private readonly tasks = new Map<string, WorkflowTask>();

  constructor(seed?: { projects?: WorkflowProject[]; tasks?: WorkflowTask[] }) {
    for (const project of seed?.projects ?? []) {
      this.projects.set(project.id, { ...project });
    }
    for (const task of seed?.tasks ?? []) {
      this.tasks.set(task.id, { ...task, tags: [...task.tags] });
      this.nextTaskSequence = Math.max(this.nextTaskSequence, extractSequence(task.id) + 1);
    }
  }

  addProject(project: WorkflowProject): void {
    this.projects.set(project.id, { ...project });
  }

  getProject(projectId: string): WorkflowProject | undefined {
    const project = this.projects.get(projectId);
    return project ? { ...project } : undefined;
  }

  listProjects(): WorkflowProject[] {
    return [...this.projects.values()].map((project) => ({ ...project }));
  }

  createTask(input: { title: string; projectId: string; priority: TaskPriority; tags: string[]; notes: string; importSource?: string }): WorkflowTask {
    const task: WorkflowTask = {
      id: createDeterministicId("task", this.nextTaskSequence++),
      title: input.title,
      normalizedTitle: normalizeTaskTitle(input.title).toLowerCase(),
      projectId: input.projectId,
      priority: input.priority,
      tags: normalizeTags(input.tags),
      completed: false,
      notes: input.notes,
      createdAt: `2026-01-${String(this.tasks.size + 1).padStart(2, "0")}T00:00:00.000Z`,
      importSource: input.importSource
    };
    this.tasks.set(task.id, task);
    return { ...task, tags: [...task.tags] };
  }

  updateTask(id: string, updater: (task: WorkflowTask) => WorkflowTask): WorkflowTask {
    const existing = this.tasks.get(id);
    if (!existing) {
      throw new Error(`Unknown task id: ${id}`);
    }
    const updated = updater({ ...existing, tags: [...existing.tags] });
    this.tasks.set(id, { ...updated, tags: [...updated.tags] });
    return { ...updated, tags: [...updated.tags] };
  }

  listTasks(): WorkflowTask[] {
    return [...this.tasks.values()]
      .map((task) => ({ ...task, tags: [...task.tags] }))
      .sort((left, right) => left.id.localeCompare(right.id));
  }

  findDuplicate(input: TaskImportInput): WorkflowTask | undefined {
    const normalizedTitle = normalizeTaskTitle(input.title).toLowerCase();
    return this.listTasks().find((task) => task.projectId === input.projectId && task.normalizedTitle === normalizedTitle);
  }
}

function extractSequence(id: string): number {
  const match = id.match(/-(\d+)$/);
  return match ? Number(match[1]) : 0;
}
