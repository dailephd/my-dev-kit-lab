import type { AnalyticsSnapshot } from "../models/analyticsSnapshot.js";

export function buildProjectLeaderboard(snapshot: AnalyticsSnapshot): string[] {
  return [...snapshot.projects]
    .sort((left, right) => right.completionRate - left.completionRate || left.staleTasks - right.staleTasks || left.projectId.localeCompare(right.projectId))
    .map((project, index) => `${index + 1}. ${project.projectId} (${project.completionRate}% complete, ${project.staleTasks} stale)`);
}
