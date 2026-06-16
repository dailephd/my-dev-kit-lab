import type { AnalyticsSnapshot } from "../models/analyticsSnapshot.js";
import { buildProjectLeaderboard } from "./buildProjectLeaderboard.js";

export function formatTaskHealthReport(snapshot: AnalyticsSnapshot): string {
  const leaderBoard = buildProjectLeaderboard(snapshot).join(" | ");
  return [
    `Total tasks: ${snapshot.totals.totalTasks}`,
    `Completed: ${snapshot.totals.completedTasks}`,
    `Open: ${snapshot.totals.openTasks}`,
    `Stale: ${snapshot.totals.staleTasks}`,
    `Projects: ${leaderBoard}`
  ].join("\n");
}
