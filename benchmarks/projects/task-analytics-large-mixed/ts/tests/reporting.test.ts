import { describe, expect, it } from "vitest";
import { buildProjectLeaderboard } from "../src/reporting/buildProjectLeaderboard.js";
import { formatTaskHealthReport } from "../src/reporting/formatTaskHealthReport.js";

const snapshot = {
  generatedAt: "2026-03-15T00:00:00.000Z",
  projects: [
    { projectId: "alpha", totalTasks: 2, completedTasks: 2, openTasks: 0, staleTasks: 0, averageStoryPoints: 4, completionRate: 100 },
    { projectId: "beta", totalTasks: 2, completedTasks: 1, openTasks: 1, staleTasks: 1, averageStoryPoints: 5, completionRate: 50 }
  ],
  totals: { totalTasks: 4, completedTasks: 3, openTasks: 1, staleTasks: 1 }
};

describe("reporting", () => {
  it("ranks projects and formats a deterministic report", () => {
    expect(buildProjectLeaderboard(snapshot)).toEqual(["1. alpha (100% complete, 0 stale)", "2. beta (50% complete, 1 stale)"]);
    expect(formatTaskHealthReport(snapshot)).toContain("Projects: 1. alpha (100% complete, 0 stale) | 2. beta (50% complete, 1 stale)");
  });
});
