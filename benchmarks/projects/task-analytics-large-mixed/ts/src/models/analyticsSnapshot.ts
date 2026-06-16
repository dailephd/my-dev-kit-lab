export type ProjectSnapshot = {
  projectId: string;
  totalTasks: number;
  completedTasks: number;
  openTasks: number;
  staleTasks: number;
  averageStoryPoints: number;
  completionRate: number;
};

export type AnalyticsSnapshot = {
  generatedAt: string;
  projects: ProjectSnapshot[];
  totals: {
    totalTasks: number;
    completedTasks: number;
    openTasks: number;
    staleTasks: number;
  };
};
