export type AnalyticsTask = {
  id: string;
  title: string;
  projectId: string;
  assignee: string;
  completed: boolean;
  storyPoints: number;
  updatedDay: number;
  labels: string[];
};
