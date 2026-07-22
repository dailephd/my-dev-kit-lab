import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { V043TargetImmutabilityConfigV1 } from "../../../src/evaluation/targetImmutability/types.js";

function sha256Hex(text: string): string {
  return createHash("sha256").update(Buffer.from(text, "utf8")).digest("hex");
}

function makeStats(kind: "file" | "directory" | "symlink" | "other") {
  return {
    isSymbolicLink: () => kind === "symlink",
    isDirectory: () => kind === "directory",
    isFile: () => kind === "file"
  };
}

function enoent(): NodeJS.ErrnoException {
  return Object.assign(new Error("ENOENT: no such file or directory"), { code: "ENOENT" });
}

interface CaptureMocks {
  lstat?: (resolvedPath: string) => Promise<ReturnType<typeof makeStats>>;
  readFile?: (resolvedPath: string) => Promise<Buffer>;
  readlink?: (resolvedPath: string) => Promise<string>;
  git?: (args: string[]) => Promise<{ stdout: string }>;
  gitCalls?: Array<{ command: string; args: string[]; options: unknown }>;
}

async function loadCaptureWithMocks(mocks: CaptureMocks) {
  vi.resetModules();
  vi.doMock("node:fs/promises", async (importOriginal) => {
    const actual = await importOriginal<typeof import("node:fs/promises")>();
    return {
      ...actual,
      lstat: mocks.lstat ?? actual.lstat,
      readFile: mocks.readFile ?? actual.readFile,
      readlink: mocks.readlink ?? actual.readlink
    };
  });
  vi.doMock("node:child_process", async (importOriginal) => {
    const actual = await importOriginal<typeof import("node:child_process")>();
    const execFileMock = vi.fn();
    Object.defineProperty(execFileMock, promisify.custom, {
      value: async (command: string, args: string[], options: unknown) => {
        mocks.gitCalls?.push({ command, args, options });
        const gitArgs = args.slice(2);
        if (mocks.git) return mocks.git(gitArgs);
        throw enoent();
      }
    });
    return { ...actual, execFile: execFileMock };
  });
  const mod = await import("../../../src/evaluation/targetImmutability/captureTargetSnapshot.js");
  return mod.captureTargetSnapshot;
}

async function unloadMocks() {
  vi.doUnmock("node:fs/promises");
  vi.doUnmock("node:child_process");
  vi.resetModules();
}

afterEach(async () => {
  await unloadMocks();
});

function makeGitRouter(responses: Record<string, string>): (args: string[]) => Promise<{ stdout: string }> {
  return async (args) => {
    const key = args.join(" ");
    if (key in responses) return { stdout: responses[key] };
    throw Object.assign(new Error(`unmocked git command: ${key}`), { code: 1 });
  };
}

const REPO_ROUTER_BASE = {
  "rev-parse --is-inside-work-tree": "true\n",
  "branch --show-current": "main\n",
  "rev-parse HEAD": "abc123\n",
  "status --porcelain=v1 --untracked-files=all": "",
  "diff --binary --no-ext-diff": "",
  "diff --cached --binary --no-ext-diff": "",
  "ls-files --others --exclude-standard": ""
};

function baseConfig(overrides: Partial<V043TargetImmutabilityConfigV1> = {}): V043TargetImmutabilityConfigV1 {
  return {
    targetRootPath: "Z:/fixture/target",
    relativeFilePaths: ["src/a.ts"],
    ...overrides
  };
}

describe("captureTargetSnapshot", () => {
  it("IMM-026 a regular configured file receives an exact SHA-256", async () => {
    const capture = await loadCaptureWithMocks({
      lstat: async (p) => (p.endsWith("a.ts") ? makeStats("file") : makeStats("directory")),
      readFile: async () => Buffer.from("hello world"),
      git: makeGitRouter(REPO_ROUTER_BASE)
    });
    const result = await capture(baseConfig());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.snapshot.configuredFiles[0].sha256).toBe(sha256Hex("hello world"));
      expect(result.snapshot.configuredFiles[0].state).toBe("file");
    }
  });

  it("IMM-027 a missing configured file remains missing", async () => {
    const capture = await loadCaptureWithMocks({
      lstat: async (p) => (p.endsWith("a.ts") ? Promise.reject(enoent()) : Promise.resolve(makeStats("directory"))),
      git: makeGitRouter(REPO_ROUTER_BASE)
    });
    const result = await capture(baseConfig());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.snapshot.configuredFiles[0].state).toBe("missing");
      expect(result.snapshot.configuredFiles[0].sha256).toBeNull();
    }
  });

  it("IMM-028 a directory remains directory", async () => {
    const capture = await loadCaptureWithMocks({
      lstat: async () => makeStats("directory"),
      git: makeGitRouter(REPO_ROUTER_BASE)
    });
    const result = await capture(baseConfig());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.snapshot.configuredFiles[0].state).toBe("directory");
      expect(result.snapshot.configuredFiles[0].sha256).toBeNull();
    }
  });

  it("IMM-029 a symbolic link is not followed", async () => {
    const readFileSpy = vi.fn(async () => Buffer.from("should not be read"));
    const capture = await loadCaptureWithMocks({
      lstat: async (p) => (p.endsWith("a.ts") ? makeStats("symlink") : makeStats("directory")),
      readlink: async () => "/somewhere/else",
      readFile: readFileSpy,
      git: makeGitRouter(REPO_ROUTER_BASE)
    });
    const result = await capture(baseConfig());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.snapshot.configuredFiles[0].state).toBe("symbolic-link");
      expect(result.snapshot.configuredFiles[0].sha256).toBeNull();
    }
    expect(readFileSpy).not.toHaveBeenCalled();
  });

  it("IMM-030 a symbolic-link target is preserved", async () => {
    const capture = await loadCaptureWithMocks({
      lstat: async (p) => (p.endsWith("a.ts") ? makeStats("symlink") : makeStats("directory")),
      readlink: async () => "/exact/link/target",
      git: makeGitRouter(REPO_ROUTER_BASE)
    });
    const result = await capture(baseConfig());
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.snapshot.configuredFiles[0].symbolicLinkTarget).toBe("/exact/link/target");
  });

  it("IMM-031 configured-file order follows config order", async () => {
    const capture = await loadCaptureWithMocks({
      lstat: async (p) => (p.includes("target") && !p.endsWith(".ts") ? makeStats("directory") : makeStats("file")),
      readFile: async () => Buffer.from("x"),
      git: makeGitRouter(REPO_ROUTER_BASE)
    });
    const result = await capture(baseConfig({ relativeFilePaths: ["src/b.ts", "src/a.ts"] }));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.snapshot.configuredFiles.map((f) => f.relativePath)).toEqual(["src/b.ts", "src/a.ts"]);
    }
  });

  it("IMM-032 targetRootPath remains exact", async () => {
    const capture = await loadCaptureWithMocks({
      lstat: async () => makeStats("directory"),
      readFile: async () => Buffer.from("x"),
      git: makeGitRouter(REPO_ROUTER_BASE)
    });
    const config = baseConfig({ targetRootPath: "Z:/fixture/target/../target" });
    const result = await capture(config);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.snapshot.targetRootPath).toBe("Z:/fixture/target/../target");
  });

  it("IMM-033 resolvedTargetRootPath is absolute", async () => {
    const capture = await loadCaptureWithMocks({
      lstat: async () => makeStats("directory"),
      readFile: async () => Buffer.from("x"),
      git: makeGitRouter(REPO_ROUTER_BASE)
    });
    const result = await capture(baseConfig());
    expect(result.ok).toBe(true);
    if (result.ok) expect(path.isAbsolute(result.snapshot.resolvedTargetRootPath)).toBe(true);
  });

  it("IMM-034 a missing target root fails", async () => {
    const capture = await loadCaptureWithMocks({
      lstat: async () => Promise.reject(enoent())
    });
    const result = await capture(baseConfig());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("TARGET_ROOT_NOT_FOUND");
  });

  it("IMM-035 a nondirectory target root fails", async () => {
    const capture = await loadCaptureWithMocks({
      lstat: async () => makeStats("file")
    });
    const result = await capture(baseConfig());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("TARGET_ROOT_NOT_DIRECTORY");
  });

  it("IMM-036 a configured-file read failure is typed", async () => {
    const capture = await loadCaptureWithMocks({
      lstat: async (p) => (p.endsWith("a.ts") ? makeStats("file") : makeStats("directory")),
      readFile: async () => Promise.reject(new Error("permission denied"))
    });
    const result = await capture(baseConfig());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("CONFIGURED_FILE_READ_FAILED");
      expect(result.fieldPath).toBe("src/a.ts");
    }
  });

  it("IMM-037 a non-Git directory produces a valid not-repository snapshot", async () => {
    const capture = await loadCaptureWithMocks({
      lstat: async () => makeStats("directory"),
      readFile: async () => Buffer.from("x"),
      git: async () => {
        throw Object.assign(new Error("fatal: not a git repository"), { code: 128 });
      }
    });
    const result = await capture(baseConfig());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.snapshot.git).toEqual({
        availability: "not-repository",
        branch: null,
        head: null,
        statusEntries: [],
        worktreeDiffSha256: null,
        stagedDiffSha256: null,
        untrackedFiles: []
      });
    }
  });

  it("IMM-038 an available repository captures branch", async () => {
    const capture = await loadCaptureWithMocks({
      lstat: async () => makeStats("directory"),
      readFile: async () => Buffer.from("x"),
      git: makeGitRouter({ ...REPO_ROUTER_BASE, "branch --show-current": "feature/x\n" })
    });
    const result = await capture(baseConfig());
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.snapshot.git.branch).toBe("feature/x");
  });

  it("IMM-039 an available repository captures HEAD", async () => {
    const capture = await loadCaptureWithMocks({
      lstat: async () => makeStats("directory"),
      readFile: async () => Buffer.from("x"),
      git: makeGitRouter({ ...REPO_ROUTER_BASE, "rev-parse HEAD": "deadbeef\n" })
    });
    const result = await capture(baseConfig());
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.snapshot.git.head).toBe("deadbeef");
  });

  it("IMM-040 an available repository captures status entries in output order", async () => {
    const capture = await loadCaptureWithMocks({
      lstat: async () => makeStats("directory"),
      readFile: async () => Buffer.from("x"),
      git: makeGitRouter({
        ...REPO_ROUTER_BASE,
        "status --porcelain=v1 --untracked-files=all": " M file1.ts\n?? file2.ts\n"
      })
    });
    const result = await capture(baseConfig());
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.snapshot.git.statusEntries).toEqual([" M file1.ts", "?? file2.ts"]);
  });

  it("IMM-041 worktree diff uses exact SHA-256", async () => {
    const diffText = "diff --git a/x b/x\n+hello\n";
    const capture = await loadCaptureWithMocks({
      lstat: async () => makeStats("directory"),
      readFile: async () => Buffer.from("x"),
      git: makeGitRouter({ ...REPO_ROUTER_BASE, "diff --binary --no-ext-diff": diffText })
    });
    const result = await capture(baseConfig());
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.snapshot.git.worktreeDiffSha256).toBe(sha256Hex(diffText));
  });

  it("IMM-042 staged diff uses exact SHA-256", async () => {
    const diffText = "diff --git a/y b/y\n+staged\n";
    const capture = await loadCaptureWithMocks({
      lstat: async () => makeStats("directory"),
      readFile: async () => Buffer.from("x"),
      git: makeGitRouter({ ...REPO_ROUTER_BASE, "diff --cached --binary --no-ext-diff": diffText })
    });
    const result = await capture(baseConfig());
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.snapshot.git.stagedDiffSha256).toBe(sha256Hex(diffText));
  });

  it("IMM-043 untracked files preserve Git order", async () => {
    const capture = await loadCaptureWithMocks({
      lstat: async (p) => (p.endsWith("target") ? makeStats("directory") : Promise.reject(enoent())),
      git: makeGitRouter({ ...REPO_ROUTER_BASE, "ls-files --others --exclude-standard": "b.txt\na.txt\n" })
    });
    const result = await capture({ targetRootPath: "Z:/fixture/target", relativeFilePaths: ["src/missing.ts"] });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.snapshot.git.untrackedFiles.map((f) => f.path)).toEqual(["b.txt", "a.txt"]);
  });

  it("IMM-044 untracked regular files are hashed", async () => {
    const capture = await loadCaptureWithMocks({
      lstat: async (p) => (p.endsWith("target") ? makeStats("directory") : makeStats("file")),
      readFile: async () => Buffer.from("untracked contents"),
      git: makeGitRouter({ ...REPO_ROUTER_BASE, "ls-files --others --exclude-standard": "new.txt\n" })
    });
    const result = await capture({ targetRootPath: "Z:/fixture/target", relativeFilePaths: ["src/other.ts"] });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.snapshot.git.untrackedFiles[0].state).toBe("file");
      expect(result.snapshot.git.untrackedFiles[0].sha256).toBe(sha256Hex("untracked contents"));
    }
  });

  it("IMM-045 untracked symbolic links are not followed", async () => {
    const readFileSpy = vi.fn(async () => Buffer.from("nope"));
    const capture = await loadCaptureWithMocks({
      lstat: async (p) => (p.endsWith("target") ? makeStats("directory") : makeStats("symlink")),
      readlink: async () => "/link/target",
      readFile: readFileSpy,
      git: makeGitRouter({ ...REPO_ROUTER_BASE, "ls-files --others --exclude-standard": "linked.txt\n" })
    });
    const result = await capture({ targetRootPath: "Z:/fixture/target", relativeFilePaths: ["src/other.ts"] });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.snapshot.git.untrackedFiles[0].state).toBe("symbolic-link");
      expect(result.snapshot.git.untrackedFiles[0].symbolicLinkTarget).toBe("/link/target");
    }
    expect(readFileSpy).not.toHaveBeenCalled();
  });

  it("IMM-046 a missing Git executable produces GIT_COMMAND_UNAVAILABLE", async () => {
    const capture = await loadCaptureWithMocks({
      lstat: async () => makeStats("directory"),
      readFile: async () => Buffer.from("x"),
      git: async () => {
        throw enoent();
      }
    });
    const result = await capture(baseConfig());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("GIT_COMMAND_UNAVAILABLE");
  });

  it("IMM-047 a failing required Git command produces GIT_COMMAND_FAILED", async () => {
    const capture = await loadCaptureWithMocks({
      lstat: async () => makeStats("directory"),
      readFile: async () => Buffer.from("x"),
      git: makeGitRouter({ "rev-parse --is-inside-work-tree": "true\n" })
      // branch --show-current intentionally unmocked -> throws generic error
    });
    const result = await capture(baseConfig());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("GIT_COMMAND_FAILED");
  });

  it("IMM-048 Git uses execFile without shell", async () => {
    const gitCalls: Array<{ command: string; args: string[]; options: unknown }> = [];
    const capture = await loadCaptureWithMocks({
      lstat: async () => makeStats("directory"),
      readFile: async () => Buffer.from("x"),
      git: makeGitRouter(REPO_ROUTER_BASE),
      gitCalls
    });
    await capture(baseConfig());
    expect(gitCalls.length).toBeGreaterThan(0);
    for (const call of gitCalls) {
      expect(call.command).toBe("git");
      expect((call.options as Record<string, unknown> | undefined)?.shell).toBeFalsy();
    }
  });

  it("IMM-049 no mutating Git command is called", async () => {
    const gitCalls: Array<{ command: string; args: string[]; options: unknown }> = [];
    const capture = await loadCaptureWithMocks({
      lstat: async () => makeStats("directory"),
      readFile: async () => Buffer.from("x"),
      git: makeGitRouter(REPO_ROUTER_BASE),
      gitCalls
    });
    await capture(baseConfig());
    const mutatingVerbs = ["reset", "restore", "clean", "stash", "checkout", "switch", "add", "commit", "merge", "rebase", "pull", "push"];
    for (const call of gitCalls) {
      const gitArgs = call.args.slice(2);
      expect(mutatingVerbs).not.toContain(gitArgs[0]);
    }
  });

  it("IMM-050 no file is created", async () => {
    const probePath = "tests/fixtures/full-workflow-library/imm-050-probe.json";
    const before = existsSync(probePath);
    const capture = await loadCaptureWithMocks({
      lstat: async () => makeStats("directory"),
      readFile: async () => Buffer.from("x"),
      git: makeGitRouter(REPO_ROUTER_BASE)
    });
    await capture(baseConfig());
    expect(existsSync(probePath)).toBe(before);
    expect(before).toBe(false);
  });

  it("IMM-051 no target file is modified", () => {
    const source = readFileSync("src/evaluation/targetImmutability/captureTargetSnapshot.ts", "utf8");
    expect(source).not.toContain("writeFile(");
    expect(source).not.toContain("unlink(");
    expect(source).not.toContain("rm(");
  });

  it("IMM-052 no timestamp is added", async () => {
    const capture = await loadCaptureWithMocks({
      lstat: async () => makeStats("directory"),
      readFile: async () => Buffer.from("x"),
      git: makeGitRouter(REPO_ROUTER_BASE)
    });
    const result = await capture(baseConfig());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(Object.keys(result.snapshot).sort()).toEqual(
        ["targetRootPath", "resolvedTargetRootPath", "configuredFiles", "git"].sort()
      );
    }
  });

  it("IMM-053 no environment-derived path is added", async () => {
    const capture = await loadCaptureWithMocks({
      lstat: async () => makeStats("directory"),
      readFile: async () => Buffer.from("x"),
      git: makeGitRouter(REPO_ROUTER_BASE)
    });
    const config = baseConfig();
    const result = await capture(config);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.snapshot.resolvedTargetRootPath).toBe(path.resolve(config.targetRootPath));
  });
});
