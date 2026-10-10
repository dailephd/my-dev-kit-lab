export const INVALID_TITLE = "INVALID_TITLE";
export const INVALID_PROJECT = "INVALID_PROJECT";
export const INVALID_EXTERNAL_ID = "INVALID_EXTERNAL_ID";

export class ValidationError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "ValidationError";
    this.code = code;
  }
}

/**
 * Returns the normalized title for a task, or throws ValidationError(INVALID_TITLE).
 */
export function validateTitle(title) {
  if (typeof title !== "string" || title.length === 0) {
    throw new ValidationError(INVALID_TITLE, "title must be a non-empty string");
  }
  return title;
}

/**
 * Returns the normalized project identity, or throws ValidationError(INVALID_PROJECT).
 */
export function normalizeProjectId(projectId) {
  if (typeof projectId !== "string") {
    throw new ValidationError(INVALID_PROJECT, "project id must be a string");
  }
  return projectId.trim();
}
