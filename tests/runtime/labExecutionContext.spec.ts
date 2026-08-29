import { existsSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createLabExecutionContext } from "../../src/runtime/labExecutionContext.js";

describe("createLabExecutionContext", () => {
  it("defaults workspaceRoot to <home>/.my-dev-kit-lab", () => {
    const context = createLabExecutionContext();
    expect(context.workspaceRoot).toBe(path.join(os.homedir(), ".my-dev-kit-lab"));
  });

  it("returns an explicit absolute workspace root unchanged apart from normalization", () => {
    const absoluteWorkspace = path.resolve(os.tmpdir(), "explicit-workspace-root");
    const context = createLabExecutionContext({ workspaceRoot: absoluteWorkspace });
    expect(context.workspaceRoot).toBe(path.normalize(absoluteWorkspace));
  });

  it("resolves an explicit relative workspace root against invocationCwd", () => {
    const invocationCwd = path.resolve(os.tmpdir(), "invocation-cwd-example");
    const context = createLabExecutionContext({ invocationCwd, workspaceRoot: "relative-workspace" });
    expect(context.workspaceRoot).toBe(path.resolve(invocationCwd, "relative-workspace"));
  });

  it("does not create the workspace directory", () => {
    const invocationCwd = mkdtempSync(path.join(os.tmpdir(), "lab-context-cwd-"));
    try {
      const context = createLabExecutionContext({ invocationCwd, workspaceRoot: "not-created-yet" });
      expect(existsSync(context.workspaceRoot)).toBe(false);
    } finally {
      rmSync(invocationCwd, { recursive: true, force: true });
    }
  });

  it("keeps invocationCwd, packageRoot, and workspaceRoot as distinct concepts", () => {
    const invocationCwd = path.resolve(os.tmpdir(), "distinct-invocation-cwd");
    const workspaceRoot = path.resolve(os.tmpdir(), "distinct-workspace-root");
    const context = createLabExecutionContext({ invocationCwd, workspaceRoot });

    expect(context.packageRoot).not.toBe(context.workspaceRoot);
    expect(context.packageRoot).not.toBe(context.invocationCwd);
    expect(context.workspaceRoot).not.toBe(context.invocationCwd);
    expect(context.resourceRoot).toBe(context.packageRoot);
  });
});
