import type { AnalyticsSnapshot, ProjectSnapshot } from "../models/analyticsSnapshot.js";
import { ProjectStore } from "../store/projectStore.js";
import { AnalyticsTaskStore } from "../store/taskStore.js";
import { listTasksByProject } from "./listTasksByProject.js";

const STALE_DAY_THRESHOLD = 10;

export function buildAnalyticsSnapshot(taskStore: AnalyticsTaskStore, projectStore: ProjectStore, currentDay: number): AnalyticsSnapshot {
  const projects = projectStore.list();
  const snapshots: ProjectSnapshot[] = projects.map((project) => {
    const tasks = listTasksByProject(taskStore, project.id);
    const completedTasks = tasks.filter((task) => task.completed).length;
    const staleTasks = tasks.filter((task) => !task.completed && currentDay - task.updatedDay >= STALE_DAY_THRESHOLD).length;
    return {
      projectId: project.id,
      totalTasks: tasks.length,
      completedTasks,
      openTasks: tasks.length - completedTasks,
      staleTasks,
      averageStoryPoints: tasks.length === 0 ? 0 : round(tasks.reduce((sum, task) => sum + task.storyPoints, 0) / tasks.length),
      completionRate: tasks.length === 0 ? 0 : round((completedTasks / tasks.length) * 100)
    };
  });

  return {
    generatedAt: `2026-03-${String(currentDay).padStart(2, "0")}T00:00:00.000Z`,
    projects: snapshots,
    totals: {
      totalTasks: snapshots.reduce((sum, snapshot) => sum + snapshot.totalTasks, 0),
      completedTasks: snapshots.reduce((sum, snapshot) => sum + snapshot.completedTasks, 0),
      openTasks: snapshots.reduce((sum, snapshot) => sum + snapshot.openTasks, 0),
      staleTasks: snapshots.reduce((sum, snapshot) => sum + snapshot.staleTasks, 0)
    }
  };
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
