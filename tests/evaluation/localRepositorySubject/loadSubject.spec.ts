import { mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  LocalRepositorySubjectConfigError,
  LocalRepositorySubjectRepositoryError,
  loadLocalRepositorySubject,
  serializeLocalRepositorySubjectManifest,
} from "../../../src/evaluation/localRepositorySubject/index.js";
import {
  commitAll,
  createCommittedRepository,
  git,
  initRepository,
  makeTempDir,
  minimalCase,
  minimalConfig,
  removeTempDir,
  tryCreateSymlink,
  writeRepositoryFile,
} from "./fixtureRepository.js";

let root: string;
beforeEach(() => {
  root = makeTempDir();
});
afterEach(() => {
  removeTempDir(root);
});

async function configErrors(config: unknown, repositoryPath = root, maxFileBytes?: number): Promise<readonly string[]> {
  try {
    await loadLocalRepositorySubject({ config, repositoryPath, maxFileBytes });
  } catch (error) {
    expect(error).toBeInstanceOf(LocalRepositorySubjectConfigError);
    return (error as LocalRepositorySubjectConfigError).errors;
  }
  throw new Error("expected a LocalRepositorySubjectConfigError");
}

describe("RSP-014 end-to-end load", () => {
  it("returns a ready runtime subject for a valid config and repository", async () => {
    const commit = createCommittedRepository(root);
    const subject = await loadLocalRepositorySubject({ config: minimalConfig(), repositoryPath: root });
    expect(subject.subjectId).toBe("fixture-subject");
    expect(subject.logicalTargetRoot).toBe("local-repository:fixture-subject");
    expect(subject.repositoryRoot).toBe(root);
    expect(subject.manifest.repository.commit).toBe(commit);
    expect(subject.evaluationCases).toHaveLength(1);
    expect(subject.eligibleFiles).toEqual(["src/main.ts", "src/util/helper.ts"]);
  });

  it("validates the config before touching Git or the filesystem", async () => {
    const missing = path.join(root, "does-not-exist");
    await expect(loadLocalRepositorySubject({ config: minimalConfig({ subjectId: "" }), repositoryPath: missing })).rejects.toBeInstanceOf(
      LocalRepositorySubjectConfigError
    );
    await expect(loadLocalRepositorySubject({ config: minimalConfig(), repositoryPath: missing })).rejects.toBeInstanceOf(
      LocalRepositorySubjectRepositoryError
    );
  });

  it("rejects a non-positive or non-integer size policy", async () => {
    createCommittedRepository(root);
    for (const bad of [0, -1, 1.5, Number.NaN]) {
      expect((await configErrors(minimalConfig(), root, bad))[0]).toContain("policy.maxFileBytes");
    }
  });
});

describe("RSP-004 containment, source roots and expected files", () => {
  it("accepts nested source roots, the repository root as '.', and a repository path with spaces", async () => {
    const spaced = path.join(root, "repo with spaces");
    mkdirSync(spaced);
    initRepository(spaced);
    writeRepositoryFile(spaced, "src/util/deep.ts");
    writeRepositoryFile(spaced, "src/main.ts");
    commitAll(spaced);
    const nested = await loadLocalRepositorySubject({
      config: minimalConfig({ cases: [minimalCase({ sourceRoots: ["src/util"], expectedFiles: ["src/util/deep.ts"], rawIncludeGlobs: ["src/util/**/*"] })] }),
      repositoryPath: spaced,
    });
    expect(nested.eligibleFiles).toEqual(["src/util/deep.ts"]);
    const dot = await loadLocalRepositorySubject({
      config: minimalConfig({ cases: [minimalCase({ sourceRoots: ["."], expectedFiles: ["src/main.ts"], rawIncludeGlobs: ["**/*"] })] }),
      repositoryPath: spaced,
    });
    expect(dot.eligibleFiles).toEqual(["src/main.ts", "src/util/deep.ts"]);
    expect(dot.manifest.sourceRoots).toEqual(["."]);
  });

  it("rejects missing or non-directory source roots with labelled errors", async () => {
    createCommittedRepository(root);
    expect(await configErrors(minimalConfig({ cases: [minimalCase({ sourceRoots: ["nope"] })] }))).toEqual([
      'config.cases[0].sourceRoots[0]: source root does not exist ("nope").',
    ]);
    expect(await configErrors(minimalConfig({ cases: [minimalCase({ sourceRoots: ["src/main.ts"] })] }))).toEqual([
      'config.cases[0].sourceRoots[0]: source root is not a directory ("src/main.ts").',
    ]);
  });

  it("rejects an expected file outside the case source roots, a missing file, and a directory", async () => {
    createCommittedRepository(root);
    writeRepositoryFile(root, "docs/readme.md", "# docs\n");
    commitAll(root, "docs");
    const errors = await configErrors(
      minimalConfig({
        cases: [minimalCase({ sourceRoots: ["src"], expectedFiles: ["docs/readme.md", "src/missing.ts", "src/util"] })],
      })
    );
    expect(errors).toEqual([
      'config.cases[0].expectedFiles[0]: expected file is outside the case source roots ("docs/readme.md").',
      'config.cases[0].expectedFiles[1]: expected file does not exist ("src/missing.ts").',
      'config.cases[0].expectedFiles[2]: expected file is not a regular file ("src/util").',
    ]);
  });

  it("never treats .git internals as subject files", async () => {
    createCommittedRepository(root);
    const errors = await configErrors(minimalConfig({ cases: [minimalCase({ sourceRoots: ["."], expectedFiles: [".git/HEAD"], rawIncludeGlobs: ["**/*"] })] }));
    expect(errors[0]).toContain("expectedFiles[0]: expected file");
    const subject = await loadLocalRepositorySubject({ config: minimalConfig({ cases: [minimalCase({ sourceRoots: ["."], rawIncludeGlobs: ["**/*"] })] }), repositoryPath: root });
    expect(subject.eligibleFiles.some((file) => file === ".git" || file.startsWith(".git/"))).toBe(false);
  });

  it("rejects path-escape spellings before any filesystem access", async () => {
    createCommittedRepository(root);
    for (const bad of ["../outside", "/abs", "C:/abs", "//unc/share", "src\\main.ts"]) {
      const errors = await configErrors(minimalConfig({ cases: [minimalCase({ sourceRoots: [bad] })] }));
      expect(errors[0]).toContain("config.cases[0].sourceRoots[0]:");
    }
  });
});

describe("RSP-005 symlinked source roots and expected files are rejected", () => {
  it("rejects a symlinked source root and a source root passing through a symlink", async () => {
    createCommittedRepository(root);
    const link = tryCreateSymlink(path.join(root, "src"), path.join(root, "linked-src"), "dir");
    if (!link.ok) {
      console.warn(`skipping: ${link.reason}`);
      return;
    }
    expect(await configErrors(minimalConfig({ cases: [minimalCase({ sourceRoots: ["linked-src"], expectedFiles: ["linked-src/main.ts"] })] }))).toEqual([
      'config.cases[0].sourceRoots[0]: source root is or passes through a symlink ("linked-src").',
    ]);
    expect((await configErrors(minimalConfig({ cases: [minimalCase({ sourceRoots: ["linked-src/util"], expectedFiles: ["linked-src/util/helper.ts"] })] })))[0]).toContain(
      "passes through a symlink"
    );
  });

  it("rejects a symlinked expected file and an expected file under a symlinked directory", async () => {
    createCommittedRepository(root);
    const fileLink = tryCreateSymlink(path.join(root, "src", "main.ts"), path.join(root, "src", "alias.ts"), "file");
    const dirLink = tryCreateSymlink(path.join(root, "src", "util"), path.join(root, "src", "util-alias"), "dir");
    if (!fileLink.ok || !dirLink.ok) {
      console.warn("skipping: symlink creation unavailable");
      return;
    }
    const errors = await configErrors(
      minimalConfig({ cases: [minimalCase({ expectedFiles: ["src/alias.ts", "src/util-alias/helper.ts"] })] })
    );
    expect(errors).toEqual([
      'config.cases[0].expectedFiles[0]: expected file is or passes through a symlink ("src/alias.ts").',
      'config.cases[0].expectedFiles[1]: expected file is or passes through a symlink ("src/util-alias/helper.ts").',
    ]);
  });
});

describe("RSP-008 and RSP-010 required expected files are never silently dropped", () => {
  it("fails when an expected file is ignored by Git", async () => {
    initRepository(root);
    writeRepositoryFile(root, ".gitignore", "src/ignored.ts\n");
    writeRepositoryFile(root, "src/main.ts");
    writeRepositoryFile(root, "src/ignored.ts");
    commitAll(root);
    expect(await configErrors(minimalConfig({ cases: [minimalCase({ expectedFiles: ["src/main.ts", "src/ignored.ts"] })] }))).toEqual([
      'config.cases[0].expectedFiles[1]: expected file is ignored by Git ("src/ignored.ts").',
    ]);
  });

  it("fails when an expected file exceeds the size policy", async () => {
    initRepository(root);
    writeRepositoryFile(root, "src/main.ts", Buffer.alloc(10, "a"));
    writeRepositoryFile(root, "src/big.ts", Buffer.alloc(11, "a"));
    commitAll(root);
    expect(await configErrors(minimalConfig({ cases: [minimalCase({ expectedFiles: ["src/main.ts", "src/big.ts"] })] }), root, 10)).toEqual([
      'config.cases[0].expectedFiles[1]: expected file exceeds the maximum file size policy ("src/big.ts").',
    ]);
  });
});

describe("RSP-011 and RSP-012 privacy-safe manifest", () => {
  async function privacyFixture(): Promise<string> {
    initRepository(root);
    writeRepositoryFile(root, ".gitignore", "secret-ignored-name.ts\n");
    writeRepositoryFile(root, "src/main.ts", "export const SENTINEL_SOURCE_TEXT = 'do-not-leak';\n");
    writeRepositoryFile(root, "src/util/helper.ts");
    writeRepositoryFile(root, "src/notes.md", "# notes\n");
    writeRepositoryFile(root, "src/NoExtension", "x\n");
    writeRepositoryFile(root, "src/huge-private-name.bin", Buffer.alloc(200, 1));
    commitAll(root);
    writeRepositoryFile(root, "src/secret-ignored-name.ts", "ignored\n");
    return git(root, "rev-parse", "HEAD").trim();
  }

  it("excludes machine paths, source text, and private file lists while retaining reproducibility metadata", async () => {
    const commit = await privacyFixture();
    const subject = await loadLocalRepositorySubject({ config: minimalConfig(), repositoryPath: root, maxFileBytes: 100 });
    const serialized = serializeLocalRepositorySubjectManifest(subject.manifest);
    for (const forbidden of [
      root,
      root.replace(/\\/g, "/"),
      path.basename(root),
      os.homedir(),
      os.tmpdir(),
      "SENTINEL_SOURCE_TEXT",
      "do-not-leak",
      "secret-ignored-name",
      "huge-private-name",
    ]) {
      expect(serialized, forbidden).not.toContain(forbidden);
    }
    const manifest = JSON.parse(serialized);
    expect(manifest).toMatchObject({
      schemaId: "my-dev-kit-lab-local-repository-subject-manifest-v1",
      schemaVersion: "1.0.0",
      subjectId: "fixture-subject",
      logicalTargetRoot: "local-repository:fixture-subject",
      // Ignored files do not make the working tree dirty in Git.
      repository: { commit, branch: "main", workingTreeDirty: false },
      sourceRoots: ["src"],
      caseCount: 1,
      caseIds: ["case-one"],
    });
    expect(manifest.inventory).toMatchObject({
      eligibleFileCount: 4,
      gitIgnoredCount: 1,
      oversizedCount: 1,
      symlinkCount: 0,
      otherExcludedCount: 0,
    });
    expect(manifest.inventory.extensionSummary).toEqual([
      { extension: "(none)", fileCount: 1 },
      { extension: "md", fileCount: 1 },
      { extension: "ts", fileCount: 2 },
    ]);
  });

  it("produces byte-identical metadata for repeated inspection of an unchanged subject", async () => {
    await privacyFixture();
    const first = await loadLocalRepositorySubject({ config: minimalConfig(), repositoryPath: root, maxFileBytes: 100 });
    const second = await loadLocalRepositorySubject({ config: minimalConfig(), repositoryPath: root, maxFileBytes: 100 });
    expect(second.manifest).toEqual(first.manifest);
    expect(serializeLocalRepositorySubjectManifest(second.manifest)).toBe(serializeLocalRepositorySubjectManifest(first.manifest));
    expect(second.eligibleFiles).toEqual(first.eligibleFiles);
    expect([...first.eligibleFiles]).toEqual([...first.eligibleFiles].sort());
  });

  it("is independent of file creation order", async () => {
    const other = makeTempDir();
    try {
      for (const [repoRoot, order] of [
        [root, ["a.ts", "b.ts", "c/d.ts"]],
        [other, ["c/d.ts", "b.ts", "a.ts"]],
      ] as const) {
        initRepository(repoRoot);
        for (const file of order) writeRepositoryFile(repoRoot, `src/${file}`);
        commitAll(repoRoot, "same");
      }
      const config = minimalConfig({ cases: [minimalCase({ expectedFiles: ["src/a.ts"] })] });
      const first = await loadLocalRepositorySubject({ config, repositoryPath: root });
      const second = await loadLocalRepositorySubject({ config, repositoryPath: other });
      expect(first.eligibleFiles).toEqual(second.eligibleFiles);
      expect(first.manifest.inventory).toEqual(second.manifest.inventory);
    } finally {
      removeTempDir(other);
    }
  });
});

describe("RSP-013 EvaluationCase adaptation", () => {
  it("separates logical and physical identity and carries validated canonical values", async () => {
    createCommittedRepository(root);
    const answerKey = {
      expectedFiles: ["src/main.ts"],
      expectedSymbols: ["value"],
      expectedFacts: [{ id: "f1", text: "value is one", weight: 1, required: true }],
      minimumCorrectFacts: 1,
    };
    const subject = await loadLocalRepositorySubject({
      config: minimalConfig({
        cases: [
          minimalCase({
            sourceRoots: ["./src/"],
            expectedFiles: ["./src/main.ts"],
            rawIncludeGlobs: ["./src/**/*.ts"],
            answerKey,
            expectedFacts: answerKey.expectedFacts,
            taskLocality: "cross-module",
            promptComplexityHint: "hint",
            projectComplexityRelevance: "relevance",
            notes: "note",
          }),
          minimalCase({ id: "case-two", expectedFiles: ["src/util/helper.ts"] }),
        ],
      }),
      repositoryPath: root,
    });
    expect(subject.evaluationCases).toHaveLength(2);
    const [first, second] = subject.evaluationCases;
    expect(first).toEqual({
      id: "case-one",
      title: "Find the value",
      benchmarkProject: "fixture-subject",
      targetRoot: "local-repository:fixture-subject",
      sourceRoots: ["src"],
      query: "Where is the value defined?",
      expectedFiles: ["src/main.ts"],
      expectedSymbols: ["value"],
      rawIncludeGlobs: ["src/**/*.ts"],
      answerKey,
      expectedFacts: answerKey.expectedFacts,
      taskLocality: "cross-module",
      promptComplexityHint: "hint",
      projectComplexityRelevance: "relevance",
      notes: "note",
      absoluteTargetRoot: root,
    });
    expect(second.targetRoot).toBe(first.targetRoot);
    expect(path.isAbsolute(first.targetRoot)).toBe(false);
    expect(first.targetRoot).not.toContain(root);
    expect(first.absoluteTargetRoot).toBe(root);
    expect(Object.prototype.hasOwnProperty.call(second, "answerKey")).toBe(false);
  });

  it("returns fresh copies so mutation cannot corrupt the subject", async () => {
    createCommittedRepository(root);
    const config = minimalConfig();
    const subject = await loadLocalRepositorySubject({ config, repositoryPath: root });
    subject.evaluationCases[0].sourceRoots.push("mutated");
    const again = await loadLocalRepositorySubject({ config, repositoryPath: root });
    expect(again.evaluationCases[0].sourceRoots).toEqual(["src"]);
  });
});
