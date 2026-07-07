import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

export type LocalProjectTargetMetadata = {
  targetRoot: string;
  toolRoot: string;
  packageName: string | null;
  packageVersion: string | null;
  hasPackageJson: boolean;
  hasSecurityTestScript: boolean;
  hasLockfile: boolean;
  branch: string | null;
  commit: string | null;
  hasGit: boolean;
  isSelf: boolean;
};

export function resolveLocalProjectTarget(
  targetPathArg: string | undefined,
  toolRoot: string
): LocalProjectTargetMetadata {
  let targetRoot: string;

  if (!targetPathArg) {
    targetRoot = toolRoot;
  } else {
    targetRoot = path.isAbsolute(targetPathArg)
      ? targetPathArg
      : path.resolve(process.cwd(), targetPathArg);

    if (!fs.existsSync(targetRoot)) {
      throw new Error(`Target path does not exist: ${targetRoot}`);
    }
    const stat = fs.statSync(targetRoot);
    if (!stat.isDirectory()) {
      throw new Error(`Target path is not a directory: ${targetRoot}`);
    }
  }

  const resolvedTargetRoot = path.resolve(targetRoot);
  const resolvedToolRoot = path.resolve(toolRoot);
  const packageMetadata = readPackageMetadata(resolvedTargetRoot);

  return {
    targetRoot: resolvedTargetRoot,
    toolRoot: resolvedToolRoot,
    packageName: packageMetadata.packageName,
    packageVersion: packageMetadata.packageVersion,
    hasPackageJson: packageMetadata.hasPackageJson,
    hasSecurityTestScript: packageMetadata.hasSecurityTestScript,
    hasLockfile: hasLockfile(resolvedTargetRoot),
    ...readGitMetadata(resolvedTargetRoot),
    isSelf: resolvedTargetRoot === resolvedToolRoot,
  };
}

function readPackageMetadata(targetRoot: string): Pick<
  LocalProjectTargetMetadata,
  "packageName" | "packageVersion" | "hasPackageJson" | "hasSecurityTestScript"
> {
  try {
    const pkgRaw = fs.readFileSync(path.join(targetRoot, "package.json"), "utf8");
    const pkg = JSON.parse(pkgRaw) as {
      name?: unknown;
      version?: unknown;
      scripts?: Record<string, unknown>;
    };
    const testSecurityScript = pkg.scripts && typeof pkg.scripts["test:security"] === "string";
    return {
      hasPackageJson: true,
      packageName: typeof pkg.name === "string" ? pkg.name : null,
      packageVersion: typeof pkg.version === "string" ? pkg.version : null,
      hasSecurityTestScript: Boolean(testSecurityScript),
    };
  } catch {
    return {
      hasPackageJson: false,
      packageName: null,
      packageVersion: null,
      hasSecurityTestScript: false,
    };
  }
}

function hasLockfile(targetRoot: string): boolean {
  return (
    fs.existsSync(path.join(targetRoot, "package-lock.json")) ||
    fs.existsSync(path.join(targetRoot, "yarn.lock")) ||
    fs.existsSync(path.join(targetRoot, "pnpm-lock.yaml"))
  );
}

function readGitMetadata(targetRoot: string): Pick<
  LocalProjectTargetMetadata,
  "branch" | "commit" | "hasGit"
> {
  try {
    const branch = execSync("git rev-parse --abbrev-ref HEAD", {
      cwd: targetRoot,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
    const commit = execSync("git rev-parse --short HEAD", {
      cwd: targetRoot,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
    return { branch, commit, hasGit: true };
  } catch {
    return { branch: null, commit: null, hasGit: false };
  }
}
