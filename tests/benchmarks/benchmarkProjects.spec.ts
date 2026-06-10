import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const projectsDir = path.join(process.cwd(), "benchmarks", "projects");
const projects = ["todo-ts", "todo-python", "todo-js", "todo-mixed-ts-py"];

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(fullPath) : [fullPath];
  });
}

describe("benchmark project structure", () => {
  it("ensures every benchmark project has a README", () => {
    for (const project of projects) {
      expect(existsSync(path.join(projectsDir, project, "README.md"))).toBe(true);
    }
  });

  it("ensures every benchmark project has source files", () => {
    for (const project of projects) {
      const sourceRoots = ["src", "python"].map((segment) => path.join(projectsDir, project, segment));
      expect(sourceRoots.some((sourceRoot) => existsSync(sourceRoot))).toBe(true);
    }
  });

  it("ensures every benchmark project has test files", () => {
    for (const project of projects) {
      expect(existsSync(path.join(projectsDir, project, "tests"))).toBe(true);
    }
  });

  it("disallows generated artifacts in benchmark projects", () => {
    for (const project of projects) {
      const files = walk(path.join(projectsDir, project)).map((fullPath) =>
        path.relative(path.join(projectsDir, project), fullPath).replace(/\\/g, "/")
      );
      expect(files.some((file) => /(^|\/)(node_modules|dist|build|coverage|lab-output)(\/|$)/.test(file))).toBe(false);
    }
  });
});
