export function validateTaskTitle(title: string): string {
  const normalized = title.trim().replace(/\s+/g, " ");
  if (!normalized) {
    throw new Error("Task title must not be empty.");
  }
  return normalized;
}

export function validateStoryPoints(storyPoints: number): number {
  if (!Number.isInteger(storyPoints) || storyPoints < 1 || storyPoints > 13) {
    throw new Error("storyPoints must be an integer between 1 and 13.");
  }
  return storyPoints;
}

export function normalizeLabels(labels: string[]): string[] {
  return [...new Set(labels.map((label) => label.trim().toLowerCase()).filter(Boolean))].sort();
}
