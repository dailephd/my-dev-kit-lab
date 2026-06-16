export type TaskPriority = "low" | "medium" | "high";

export type WorkflowTask = {
  id: string;
  title: string;
  normalizedTitle: string;
  projectId: string;
  priority: TaskPriority;
  tags: string[];
  completed: boolean;
  notes: string;
  createdAt: string;
  completedAt?: string;
  importSource?: string;
};

export type TaskFilter = {
  projectId?: string;
  query?: string;
  tag?: string;
  completed?: boolean;
  priority?: TaskPriority;
};

export type TaskSummary = {
  total: number;
  completed: number;
  open: number;
  byProject: Record<string, { total: number; completed: number; open: number }>;
  highPriorityOpenTitles: string[];
};

export type TaskImportInput = {
  title: string;
  projectId: string;
  priority?: TaskPriority;
  tags?: string[];
  notes?: string;
};
