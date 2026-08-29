import os from "node:os";
import path from "node:path";
import { discoverPackageRoot } from "./packageRoot.js";

/**
 * Read-only description of where a lab command is running from.
 *
 * invocationCwd  - directory the user launched the command from.
 * packageRoot    - root of the installed/checked-out my-dev-kit-lab package; read-only by default.
 * workspaceRoot  - writable location owned by my-dev-kit-lab, separate from packageRoot.
 * resourceRoot   - root bundled runtime resources are resolved from.
 */
export type LabExecutionContext = {
  readonly invocationCwd: string;
  readonly packageRoot: string;
  readonly workspaceRoot: string;
  readonly resourceRoot: string;
};

export type CreateLabExecutionContextOptions = {
  invocationCwd?: string;
  packageRoot?: string;
  workspaceRoot?: string;
};

const DEFAULT_WORKSPACE_DIR_NAME = ".my-dev-kit-lab";

export function createLabExecutionContext(
  options: CreateLabExecutionContextOptions = {}
): LabExecutionContext {
  const invocationCwd = path.resolve(options.invocationCwd ?? process.cwd());
  const packageRoot = path.resolve(options.packageRoot ?? discoverPackageRoot());
  const workspaceRoot = resolveWorkspaceRoot(options.workspaceRoot, invocationCwd);
  const resourceRoot = packageRoot;

  return Object.freeze({
    invocationCwd,
    packageRoot,
    workspaceRoot,
    resourceRoot
  });
}

function resolveWorkspaceRoot(explicitWorkspaceRoot: string | undefined, invocationCwd: string): string {
  if (!explicitWorkspaceRoot) {
    return path.join(os.homedir(), DEFAULT_WORKSPACE_DIR_NAME);
  }
  return path.resolve(
    path.isAbsolute(explicitWorkspaceRoot) ? explicitWorkspaceRoot : path.resolve(invocationCwd, explicitWorkspaceRoot)
  );
}
