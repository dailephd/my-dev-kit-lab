import { summarizeProject } from "./projectSummary.js";
import { TaskService } from "./taskService.js";
import { TaskStore } from "./taskStore.js";

export { summarizeProject } from "./projectSummary.js";
export { TaskService } from "./taskService.js";
export { TaskNotFoundError, TaskStore, normalizeExternalId } from "./taskStore.js";
export {
  INVALID_EXTERNAL_ID,
  INVALID_PROJECT,
  INVALID_TITLE,
  ValidationError,
  normalizeProjectId,
  validateTitle
} from "./validation.js";

/**
 * Creates an independent in-memory board: a store, a service over it, and a summary helper.
 */
export function createTaskBoard() {
  const store = new TaskStore();
  const service = new TaskService(store);
  return { store, service, summarize: (projectId) => summarizeProject(store, projectId) };
}
