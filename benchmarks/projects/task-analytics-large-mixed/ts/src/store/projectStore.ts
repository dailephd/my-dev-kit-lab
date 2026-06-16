import type { AnalyticsProject } from "../models/project.js";

export class ProjectStore {
  private readonly projects = new Map<string, AnalyticsProject>();

  constructor(seed: AnalyticsProject[] = []) {
    for (const project of seed) {
      this.projects.set(project.id, { ...project });
    }
  }

  list(): AnalyticsProject[] {
    return [...this.projects.values()].map((project) => ({ ...project }));
  }

  get(projectId: string): AnalyticsProject | undefined {
    const project = this.projects.get(projectId);
    return project ? { ...project } : undefined;
  }
}
