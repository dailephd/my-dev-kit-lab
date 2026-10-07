import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadLocalRepositorySubject, type LocalRepositorySubject } from "../../../src/evaluation/localRepositorySubject/index.js";
import {
  CONTEXT_PACK_EXTERNAL_PERSISTENCE_FAILURE_MESSAGE,
  CONTEXT_PACK_GENERATION_SELF_ONLY_MESSAGE,
  CONTEXT_PACK_PRIVACY_FAILURE_MESSAGE,
  CONTEXT_PACK_UNEXPECTED_EXTERNAL_FAILURE_MESSAGE,
  contextPackGenerationPlugin,
  validateContextPackGenerationConfig,
  type ContextPackGenerationArtifactIo,
  type ContextPackGenerationConfig
} from "../../../src/experiments/plugins/contextPackGeneration/index.js";
import type { ExperimentExecutionContext, ExperimentTarget } from "../../../src/experiments/types.js";
import { makeTempDir, removeTempDir } from "../../evaluation/localRepositorySubject/fixtureRepository.js";
import type { LocalSubjectFixture } from "../contextWindowScaling/localSubjectFixture.js";
import { clearCpgKitEnv, CPG_MARKERS, cpgKitCommand, cpgLocalSubjectCases, createCpgLocalSubjectFixture, hashTree } from "./externalLocalFixture.js";

const flags = vi.hoisted(() => ({ failAnalysis: false, failProjection: false, leakProjection: false }));

vi.mock("../../../src/experiments/plugins/contextPackGeneration/analysis.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../../src/experiments/plugins/contextPackGeneration/analysis.js")>();
  return {
    ...original,
    analyzeContextPackGeneration: (...args: Parameters<typeof original.analyzeContextPackGeneration>) => {
      if (flags.failAnalysis) throw new Error("analysis boom C:\\private\\path");
      return original.analyzeContextPackGeneration(...args);
    }
  };
});

vi.mock("../../../src/experiments/plugins/contextPackGeneration/localSubjectPrivacy.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../../src/experiments/plugins/contextPackGeneration/localSubjectPrivacy.js")>();
  return {
    ...original,
    projectContextPackExecutionForExternalLocalPersistence: (...args: Parameters<typeof original.projectContextPackExecutionForExternalLocalPersistence>) => {
      if (flags.failProjection) throw new Error("projection boom C:\\private\\path");
      const projected = original.projectContextPackExecutionForExternalLocalPersistence(...args);
      // A defective projection that lets a real file identity through; the assertion must catch it.
      if (flags.leakProjection) projected[0].caseName = args[0][0].evidence.treatments[0].includedFiles[0];
      return projected;
    }
  };
});

vi.setConfig({ testTimeout: 180_000, hookTimeout: 180_000 });

const EXEC = "context-pack-generation-execution.json";
const ANALYSIS = "context-pack-generation-analysis.json";
const MANIFEST = "local-repository-subject-manifest.json";

let fixture: LocalSubjectFixture;
let subject: LocalRepositorySubject;
let parent: string;
let outputRoot: string;

beforeEach(async () => {
  flags.failAnalysis = false;
  flags.failProjection = false;
  flags.leakProjection = false;
  fixture = await createCpgLocalSubjectFixture();
  subject = await loadLocalRepositorySubject({ config: { schemaVersion: "1.0.0", subjectId: "cpg-subject", cases: cpgLocalSubjectCases() }, repositoryPath: fixture.root });
  parent = makeTempDir("cpg-plugin-");
  outputRoot = path.join(parent, "run");
});

afterEach(() => {
  clearCpgKitEnv();
  for (const directory of [...fixture.directories, parent]) removeTempDir(directory);
});

function externalTarget(root: string): ExperimentTarget {
  return { kind: "external-local", targetRoot: root, toolRoot: process.cwd(), packageName: null, packageVersion: null, hasPackageJson: false, hasLockfile: false, branch: null, commit: null, hasGit: true, isSelf: false };
}

function configOf(config?: unknown): ContextPackGenerationConfig {
  const validated = validateContextPackGenerationConfig({ kitCommand: cpgKitCommand(), ...(config as object) });
  if (!validated.valid) throw new Error(validated.errors.join(" "));
  return validated.config as ContextPackGenerationConfig;
}

type Recorder = { io: Partial<ContextPackGenerationArtifactIo>; writes: string[]; removed: string[] };

/** Real filesystem behavior with an optional failure injected at the nth write (1-based). */
function recorder(failAt?: number): Recorder {
  const writes: string[] = [];
  const removed: string[] = [];
  let count = 0;
  return {
    writes,
    removed,
    io: {
      writeFile: async (filePath, content) => {
        count += 1;
        if (count === failAt) throw new Error(`disk full at ${filePath}`);
        writes.push(path.basename(filePath));
        writeFileSync(filePath, content, "utf8");
      },
      removeFile: async (filePath) => {
        removed.push(path.basename(filePath));
        const { rmSync } = await import("node:fs");
        rmSync(filePath, { force: true });
      }
    }
  };
}

function plugin(options: { target?: ExperimentTarget; inputs?: Record<string, unknown>; config?: unknown; outputRoot?: string | null } = {}) {
  const context: ExperimentExecutionContext<ContextPackGenerationConfig> = {
    runId: "run-ext",
    startedAt: new Date(),
    toolRoot: process.cwd(),
    target: options.target ?? externalTarget(fixture.root),
    config: configOf(options.config),
    ...(options.outputRoot === null ? {} : { outputRoot: options.outputRoot ?? outputRoot }),
    inputs: options.inputs ?? { localSubject: subject }
  };
  return contextPackGenerationPlugin.run(context);
}

const files = (): string[] => (existsSync(outputRoot) ? readdirSync(outputRoot).sort() : []);

describe("plugin external-local boundary", () => {
  it("fails closed for an external target without a local subject, and rejects a subject with a self target", async () => {
    await expect(plugin({ inputs: {} })).rejects.toThrow(CONTEXT_PACK_GENERATION_SELF_ONLY_MESSAGE);
    await expect(plugin({ target: { ...externalTarget(fixture.root), kind: "self", isSelf: true }, inputs: { localSubject: subject } })).rejects.toThrow(
      "Local-repository subject mode requires an external-local target."
    );
    expect(files()).toEqual([]);
  });

  it("rejects a target that is not the subject's repository, bundled filters, and a missing output root", async () => {
    const other = makeTempDir("cpg-other-");
    try {
      await expect(plugin({ target: externalTarget(other) })).rejects.toThrow("The selected --target is not the repository the local subject was loaded from.");
    } finally {
      removeTempDir(other);
    }
    await expect(plugin({ config: { caseIds: ["cpg-case-one"] } })).rejects.toThrow("Case and benchmark-project filters are not supported for an external local repository subject");
    await expect(plugin({ config: { benchmarkProjects: ["cpg-subject"] } })).rejects.toThrow("Case and benchmark-project filters are not supported");
    await expect(plugin({ outputRoot: null })).rejects.toThrow("Local-repository subject mode requires an experiment output directory.");
    expect(files()).toEqual([]);
  });

  it("declares self and external-local targets", () => {
    expect(contextPackGenerationPlugin.metadata.supportedTargets).toEqual(["self", "external-local"]);
  });
});

describe("plugin external-local success", () => {
  it("writes exactly the execution artifact, the analysis artifact, then the manifest, and never a pack body", async () => {
    const recording = recorder();
    const run = await plugin({ inputs: { localSubject: subject, contextPackArtifactIo: recording.io } });
    expect(recording.writes).toEqual([EXEC, ANALYSIS, MANIFEST]);
    expect(files()).toEqual([ANALYSIS, EXEC, MANIFEST].sort());
    expect(existsSync(path.join(outputRoot, "packs"))).toBe(false);

    expect(run.status).toBe("completed");
    expect(run.target).toMatchObject({ kind: "external-local", isSelf: false, privacyProjection: "external-local-redacted", targetRoot: "local-repository:cpg-subject" });
    expect(run.artifacts.map((artifact) => artifact.id)).toEqual(["context-pack-generation-execution", "context-pack-generation-analysis", "local-repository-subject-manifest"]);
    expect(run.artifacts.map((artifact) => artifact.path)).toEqual([EXEC, ANALYSIS, MANIFEST]);
    expect(run.metadata).toMatchObject({ executionArtifactPath: EXEC, analysisArtifactPath: ANALYSIS });
    expect(run.cases.map((entry) => entry.name)).toEqual(["<redacted case title>", "<redacted case title>"]);
    expect(run.caseExecutionEvidence.every((entry) => entry.identityRedaction !== undefined)).toBe(true);
    const serialized = JSON.stringify(run);
    for (const secret of [CPG_MARKERS.engineFile, CPG_MARKERS.engineSymbol, CPG_MARKERS.title, CPG_MARKERS.engineSource, fixture.root, outputRoot]) expect(serialized).not.toContain(secret);
  });

  it("leaves the target byte-for-byte unchanged", async () => {
    const before = hashTree(fixture.root);
    await plugin();
    expect(hashTree(fixture.root)).toEqual(before);
  });
});

describe("plugin external-local failure atomicity: no durable output", () => {
  const failsWith = async (message: string, inputs?: Record<string, unknown>) => {
    const recording = recorder();
    await expect(plugin({ inputs: { localSubject: subject, contextPackArtifactIo: recording.io, ...inputs } })).rejects.toThrow(message);
    expect(recording.writes).toEqual([]);
    expect(files()).toEqual([]);
    return recording;
  };

  it("privacy projection failure writes nothing and states so without the cause", async () => {
    flags.failProjection = true;
    const error = await plugin({ inputs: { localSubject: subject } }).catch((caught: Error) => caught);
    expect((error as Error).message).toBe(CONTEXT_PACK_PRIVACY_FAILURE_MESSAGE);
    expect((error as Error).message).not.toContain("private");
    expect(files()).toEqual([]);
    flags.failProjection = true;
    await failsWith(CONTEXT_PACK_PRIVACY_FAILURE_MESSAGE);
  });

  it("privacy assertion failure (a real identity survives projection) writes nothing", async () => {
    flags.leakProjection = true;
    await failsWith(CONTEXT_PACK_PRIVACY_FAILURE_MESSAGE);
  });

  it("analysis failure before persistence writes nothing and withholds the cause", async () => {
    flags.failAnalysis = true;
    const error = await plugin({ inputs: { localSubject: subject } }).catch((caught: Error) => caught);
    expect((error as Error).message).toBe(CONTEXT_PACK_UNEXPECTED_EXTERNAL_FAILURE_MESSAGE);
    expect(files()).toEqual([]);
  });

  it("index failure, eligible-universe violation and target mutation write nothing", async () => {
    process.env.CPG_KIT_INDEX_FAIL = "1";
    await failsWith("context-pack index preparation failed for a configured case");
    delete process.env.CPG_KIT_INDEX_FAIL;
    process.env.CPG_KIT_SEARCH_EXTRA = "src/ignored.ts";
    await failsWith("outside the eligible subject universe");
    delete process.env.CPG_KIT_SEARCH_EXTRA;
    process.env.CPG_KIT_MUTATE_FILE = path.join(fixture.root, CPG_MARKERS.engineFile);
    await failsWith("the target changed during execution");
  });
});

describe("plugin external-local durable write failure", () => {
  it.each([
    [1, [], []],
    [2, [EXEC], [EXEC]],
    [3, [EXEC, ANALYSIS], [ANALYSIS, EXEC]]
  ] as const)("a failure on write %i removes only the files this attempt created", async (failAt, written, removedInOrder) => {
    const unrelated = path.join(outputRoot, "unrelated.txt");
    const recording = recorder(failAt);
    const { mkdirSync } = await import("node:fs");
    mkdirSync(outputRoot, { recursive: true });
    writeFileSync(unrelated, "keep me");
    const before = hashTree(fixture.root);
    await expect(plugin({ inputs: { localSubject: subject, contextPackArtifactIo: recording.io } })).rejects.toThrow(CONTEXT_PACK_EXTERNAL_PERSISTENCE_FAILURE_MESSAGE);
    expect(recording.writes).toEqual(written);
    expect(recording.removed).toEqual(removedInOrder);
    expect(files()).toEqual(["unrelated.txt"]);
    expect(readFileSync(unrelated, "utf8")).toBe("keep me");
    expect(hashTree(fixture.root)).toEqual(before);
  });

  it("does not claim success and does not remove an artifact that already existed before this attempt", async () => {
    const { mkdirSync } = await import("node:fs");
    mkdirSync(outputRoot, { recursive: true });
    writeFileSync(path.join(outputRoot, EXEC), "previous");
    const recording = recorder(3);
    await expect(plugin({ inputs: { localSubject: subject, contextPackArtifactIo: recording.io } })).rejects.toThrow(CONTEXT_PACK_EXTERNAL_PERSISTENCE_FAILURE_MESSAGE);
    expect(recording.removed).toEqual([ANALYSIS]);
    expect(existsSync(path.join(outputRoot, EXEC))).toBe(true);
  });
});
