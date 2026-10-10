import { execFileSync } from "node:child_process";
import { cpSync, existsSync, readFileSync, readdirSync, rmSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { applyPatchToSandbox, assertReadAgentSuccessCorpus } from "../../../src/evaluation/agentSuccess/index.js";
import { buildMinimalHostEnv, snapshotProjectTree } from "../../../src/evaluation/benchmarkSandbox/index.js";
import { makeSandbox, makeTempDir, useSandboxTestCleanup } from "../../evaluation/benchmarkSandbox/sandboxTestHelpers.js";

/**
 * PACK-059: the canonical projects carry an intentional project-local `.gitattributes` (`* text eol=lf`). These tests prove
 * that attribute is what keeps the reference patches applicable when Git is configured the way a normal Windows
 * checkout is (`core.autocrlf=true`), on every platform, by configuring Git explicitly instead of relying on the host.
 */
useSandboxTestCleanup();

const repoRoot = process.cwd();
const corpus = assertReadAgentSuccessCorpus(repoRoot);
const projectIds = [...new Set(corpus.tasks.map((task) => task.benchmarkProject))].sort();
const projectRootOf = (project: string): string => path.join(repoRoot, "benchmarks", "projects", project);

function filesOf(root: string): string[] {
  return (readdirSync(root, { recursive: true, withFileTypes: true }) as import("node:fs").Dirent[])
    .filter((entry) => entry.isFile())
    .map((entry) => path.join(entry.parentPath, entry.name))
    .filter((file) => !file.split(path.sep).includes(".git"))
    .sort();
}

const isolatedGit = (cwd: string, ...args: string[]): string =>
  execFileSync("git", ["-c", "user.name=lab", "-c", "user.email=lab@example.invalid", "-c", "core.autocrlf=true", "-c", "core.safecrlf=false", ...args], {
    cwd,
    encoding: "utf8",
    env: buildMinimalHostEnv(process.env, { GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: process.platform === "win32" ? "NUL" : "/dev/null", HOME: cwd, USERPROFILE: cwd })
  });

/** Commits a copy of the project, deletes the working files and checks them out again under core.autocrlf=true. */
function checkoutUnderAutocrlf(project: string, options: { keepAttributes: boolean }): string {
  const root = path.join(makeTempDir("lab-eol-"), "checkout");
  cpSync(projectRootOf(project), root, { recursive: true });
  if (!options.keepAttributes) rmSync(path.join(root, ".gitattributes"));
  isolatedGit(root, "init", "-q");
  isolatedGit(root, "add", "-A");
  isolatedGit(root, "commit", "-q", "-m", "canonical history");
  for (const entry of readdirSync(root)) if (entry !== ".git") rmSync(path.join(root, entry), { recursive: true, force: true });
  isolatedGit(root, "checkout", "--", ".");
  return root;
}

describe("PACK-059 line-ending contract of the canonical benchmark projects", () => {
  it("covers both canonical projects and keeps the intentional project-local .gitattributes", () => {
    expect(projectIds).toEqual(["agent-success-inventory-node", "agent-success-task-board-node"]);
    for (const project of projectIds) {
      const attributes = path.join(projectRootOf(project), ".gitattributes");
      expect(existsSync(attributes), project).toBe(true);
      expect(readFileSync(attributes, "utf8").replace(/\r\n/g, "\n")).toContain("* text eol=lf");
    }
  });

  it("stores no carriage return in any project file or reference patch", () => {
    for (const project of projectIds) {
      for (const file of filesOf(projectRootOf(project))) expect(readFileSync(file).includes(0x0d), file).toBe(false);
    }
    for (const task of corpus.tasks) expect(task.deterministicFixture?.patch.includes("\r"), task.id).toBe(false);
  });

  it("control: without the attribute, a core.autocrlf=true checkout rewrites the sources to CRLF", () => {
    for (const project of projectIds) {
      const checkout = checkoutUnderAutocrlf(project, { keepAttributes: false });
      const sources = filesOf(checkout).filter((file) => file.endsWith(`${path.sep}validation.js`) || file.endsWith(`${path.sep}quantity.js`));
      expect(sources.length, project).toBeGreaterThan(0);
      for (const file of sources) expect(readFileSync(file).includes(0x0d), `${project}: ${file}`).toBe(true);
    }
  });

  it("with the attribute, a core.autocrlf=true checkout stays LF and every reference patch still applies", async () => {
    for (const project of projectIds) {
      const checkout = checkoutUnderAutocrlf(project, { keepAttributes: true });
      for (const file of filesOf(checkout)) expect(readFileSync(file).includes(0x0d), file).toBe(false);
      for (const task of corpus.tasks.filter((entry) => entry.benchmarkProject === project)) {
        const sandbox = await makeSandbox(checkout, `eol-${task.id}`);
        const result = await applyPatchToSandbox({ sandbox, rawProposal: task.deterministicFixture!.patch, protectedFiles: task.protectedFiles });
        expect(result.outcome, task.id).toBe("success");
      }
    }
  }, 300_000);

  it("a CRLF-encoded provider patch is rejected by the Git check without half-applying", async () => {
    const task = corpus.tasks[0]!;
    const sandbox = await makeSandbox(checkoutUnderAutocrlf(task.benchmarkProject, { keepAttributes: true }), "eol-crlf-patch");
    const before = await snapshotProjectTree(sandbox.projectRoot, { excludedNames: [".git"] });
    const crlfPatch = task.deterministicFixture!.patch.replace(/\n/g, "\r\n");
    const result = await applyPatchToSandbox({ sandbox, rawProposal: crlfPatch, protectedFiles: task.protectedFiles });
    // A CRLF patch cannot match the LF working tree: it is rejected by the Git check and the sandbox is left untouched.
    expect(result.outcome).toBe("git-check-failure");
    expect(await snapshotProjectTree(sandbox.projectRoot, { excludedNames: [".git"] })).toEqual(before);
  }, 120_000);
});
