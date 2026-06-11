export const projectName = "my-dev-kit-lab";

export function describeLab(): string {
  return `${projectName} hosts deterministic benchmark projects and validation workflows for my-dev-kit.`;
}

export * from "./report/index.js";
export * from "./screenshot/index.js";
export * from "./evaluation/index.js";
export * from "./prompts/index.js";
export * from "./agents/index.js";
export * from "./gallery/index.js";
