import { ProjectStore } from "../store/projectStore.js";

export function assertKnownProject(projectStore: ProjectStore, projectId: string): string {
  const normalized = projectId.trim();
  if (!normalized) {
    throw new Error("projectId must not be empty.");
  }
  if (!projectStore.get(normalized)) {
    throw new Error(`Unknown project id: ${normalized}`);
  }
  return normalized;
}
