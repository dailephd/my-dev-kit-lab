import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  SYNTHETIC_REPOSITORY_MANIFEST_FILE_NAME,
  SyntheticRepositoryMaterializationError,
  materializeSyntheticRepository,
  planSyntheticRepositoryCase,
  validateSyntheticRepositoryManifest,
  verifySyntheticRepositoryMaterialization,
} from "../../../src/evaluation/syntheticRepository/index.js";
import type { SyntheticRepositoryCaseSpecV1, SyntheticRepositoryPlanV1 } from "../../../src/evaluation/syntheticRepository/index.js";
import { makeCase } from "./planOracle.js";
import { makeTempRoot, measureRepository, readTree, removeTempRoot, sha256Of } from "./repositoryInspector.js";

let root: string;

beforeEach(() => {
  root = makeTempRoot();
});

// Removing the ~20k-file maximum-bound tree can exceed the default 10 s hook timeout on slow hosted filesystems.
afterEach(() => {
  removeTempRoot(root);
}, 120_000);

function planFor(overrides: Partial<SyntheticRepositoryCaseSpecV1> = {}): SyntheticRepositoryPlanV1 {
  return planSyntheticRepositoryCase(makeCase({ id: "mat-case", seed: "mat-seed", ...overrides }));
}

function snapshot(directory: string): Record<string, string> {
  return Object.fromEntries(readTree(directory).map((file) => [file.path, sha256Of(file.content)] as const));
}

function failure(action: () => unknown): SyntheticRepositoryMaterializationError {
  try {
    action();
  } catch (error) {
    expect(error).toBeInstanceOf(SyntheticRepositoryMaterializationError);
    return error as SyntheticRepositoryMaterializationError;
  }
  throw new Error("expected materialization to fail");
}

describe("synthetic repository materialization", () => {
  for (const language of ["typescript", "python"] as const) {
    it(`materializes a ${language} repository inside the output root with a sibling manifest`, () => {
      const plan = planFor({ language, taskLocality: "cross-module" });
      const result = materializeSyntheticRepository(plan, root);
      const caseDirectory = path.join(root, plan.caseId);
      expect(result.reusedExistingMaterialization).toBe(false);
      expect(path.relative(realpathSync(root), result.repositoryRoot).split(path.sep)).toEqual([plan.caseId, "repository"]);
      expect(path.relative(realpathSync(root), result.manifestPath).split(path.sep)).toEqual([plan.caseId, SYNTHETIC_REPOSITORY_MANIFEST_FILE_NAME]);
      expect(readdirSync(root)).toEqual([plan.caseId]);
      expect(readdirSync(caseDirectory).sort()).toEqual(["repository", SYNTHETIC_REPOSITORY_MANIFEST_FILE_NAME]);
      expect(existsSync(path.join(result.repositoryRoot, SYNTHETIC_REPOSITORY_MANIFEST_FILE_NAME))).toBe(false);

      const tree = readTree(result.repositoryRoot);
      expect(tree.map((file) => file.path)).toEqual(result.manifest.files.map((record) => record.path));
      for (const file of tree) {
        const record = result.manifest.files.find((candidate) => candidate.path === file.path);
        expect(record?.sha256).toBe(sha256Of(file.content));
        expect(record?.byteLength).toBe(Buffer.byteLength(file.content, "utf8"));
        expect(record?.charCount).toBe(file.content.length);
      }
      const bytes = readFileSync(path.join(result.repositoryRoot, plan.modules[0].path));
      expect(bytes.includes(13)).toBe(false);
      expect(bytes.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf]))).toBe(false);
      expect(verifySyntheticRepositoryMaterialization({ manifestPath: result.manifestPath, repositoryRoot: result.repositoryRoot }).ok).toBe(true);
    });
  }

  it("writes a manifest without host, time, process or staging identity", () => {
    const result = materializeSyntheticRepository(planFor(), root);
    const text = readFileSync(result.manifestPath, "utf8");
    expect(text.endsWith("\n")).toBe(true);
    expect(text).not.toContain("\r");
    expect(JSON.parse(text)).toEqual(result.manifest);
    for (const forbidden of [root, root.split(path.sep).join("/"), os.tmpdir(), os.hostname(), process.cwd(), ".synthetic-staging"]) {
      expect(text, forbidden).not.toContain(JSON.stringify(forbidden).slice(1, -1));
    }
    expect(text).not.toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:/);
    expect(text).not.toMatch(/"(mtime|ctime|createdAt|timestamp|hostname|username|platform|pid|cwd)"/i);
    expect(result.manifest.logicalTargetRoot).toBe("synthetic/mat-case/repository");
    expect(result.manifest.schemaVersion).toBe("1.0.0");
  });

  it("reports aggregate metrics that match the files and the existing estimator contract", () => {
    const result = materializeSyntheticRepository(planFor({ testFileCount: 3 }), root);
    const tree = readTree(result.repositoryRoot);
    const aggregate = result.manifest.aggregate;
    expect(aggregate.fileCount).toBe(tree.length);
    expect(aggregate.totalBytes).toBe(tree.reduce((total, file) => total + Buffer.byteLength(file.content, "utf8"), 0));
    expect(aggregate.totalChars).toBe(tree.reduce((total, file) => total + file.content.length, 0));
    expect(aggregate.estimatedContentTokens).toBe(Math.ceil(aggregate.totalChars / 4));
    expect(aggregate.tokenCountMethod).toBe("estimated_chars_div_4");
    expect(aggregate.sourceFileCount + aggregate.testFileCount + aggregate.supportFileCount).toBe(aggregate.fileCount);
    for (const record of result.manifest.files) expect(record.estimatedContentTokens).toBe(Math.ceil(record.charCount / 4));
  });

  it("is an idempotent no-op for the same plan and does not rewrite files", () => {
    const plan = planFor({ language: "python" });
    const first = materializeSyntheticRepository(plan, root);
    const before = snapshot(root);
    const target = path.join(first.repositoryRoot, plan.modules[0].path);
    const mtime = statSync(target).mtimeMs;
    const directoryId = statSync(path.join(root, plan.caseId)).ino;
    const second = materializeSyntheticRepository(planSyntheticRepositoryCase(makeCase({ id: "mat-case", seed: "mat-seed", language: "python" })), root);
    expect(second.reusedExistingMaterialization).toBe(true);
    expect(second.manifest).toEqual(first.manifest);
    expect(second.repositoryRoot).toBe(first.repositoryRoot);
    expect(second.manifest.repositoryContentIdentity).toBe(first.manifest.repositoryContentIdentity);
    expect(snapshot(root)).toEqual(before);
    expect(statSync(target).mtimeMs).toBe(mtime);
    expect(statSync(path.join(root, plan.caseId)).ino).toBe(directoryId);
    expect(readdirSync(root)).toEqual([plan.caseId]);
  });

  it("fails with a collision for a foreign existing output child and changes nothing", () => {
    const plan = planFor();
    mkdirSync(path.join(root, plan.caseId));
    writeFileSync(path.join(root, plan.caseId, "foreign.txt"), "not ours\n");
    const before = snapshot(root);
    const error = failure(() => materializeSyntheticRepository(plan, root));
    expect(error.code).toBe("collision");
    expect(snapshot(root)).toEqual(before);
    expect(readdirSync(root)).toEqual([plan.caseId]);
  });

  it("fails with a collision when a materialized file was changed, was added or is missing", () => {
    const plan = planFor();
    const first = materializeSyntheticRepository(plan, root);
    const changed = path.join(first.repositoryRoot, plan.modules[0].path);
    writeFileSync(changed, `${readFileSync(changed, "utf8")}// drift\n`);
    const drifted = snapshot(root);
    expect(failure(() => materializeSyntheticRepository(plan, root)).code).toBe("collision");
    expect(snapshot(root)).toEqual(drifted);

    writeFileSync(changed, readFileSync(changed, "utf8").replace("// drift\n", ""));
    writeFileSync(path.join(first.repositoryRoot, "extra.txt"), "extra\n");
    expect(failure(() => materializeSyntheticRepository(plan, root)).code).toBe("collision");
    expect(existsSync(path.join(first.repositoryRoot, "extra.txt"))).toBe(true);
  });

  it("fails with a collision for a different generation under the same case id", () => {
    materializeSyntheticRepository(planFor(), root);
    const other = planFor({ seed: "another-seed" });
    expect(failure(() => materializeSyntheticRepository(other, root)).code).toBe("collision");
  });

  it("fails with a collision for a malformed, missing or foreign manifest", () => {
    const plan = planFor();
    const first = materializeSyntheticRepository(plan, root);
    writeFileSync(first.manifestPath, "{ not json");
    expect(failure(() => materializeSyntheticRepository(plan, root)).code).toBe("collision");
    writeFileSync(first.manifestPath, JSON.stringify({ schemaVersion: "1.0.0" }));
    expect(failure(() => materializeSyntheticRepository(plan, root)).code).toBe("collision");
    writeFileSync(first.manifestPath, JSON.stringify({ ...first.manifest, schemaVersion: "2.0.0" }, null, 2));
    expect(failure(() => materializeSyntheticRepository(plan, root)).code).toBe("collision");
  });

  it("verifier rejects traversal, duplicate paths, unsupported schema major and drift without repairing", () => {
    const first = materializeSyntheticRepository(planFor(), root);
    const base = first.manifest;
    const verifyText = (value: unknown): { ok: boolean; issues: string[] } => {
      writeFileSync(first.manifestPath, typeof value === "string" ? value : JSON.stringify(value, null, 2));
      return verifySyntheticRepositoryMaterialization({ manifestPath: first.manifestPath, repositoryRoot: first.repositoryRoot });
    };
    const withFirstPath = (replacement: string) => ({ ...base, files: [{ ...base.files[0], path: replacement }, ...base.files.slice(1)] });

    for (const bad of ["../evil.txt", "/abs/evil.txt", "a/../b.txt", "a\\b.txt", "C:/evil.txt", ""]) {
      const result = verifyText(withFirstPath(bad));
      expect(result.ok, bad).toBe(false);
      expect(result.issues.join("\n")).toMatch(/safe relative logical path/);
    }
    const duplicate = verifyText({ ...base, files: [base.files[0], base.files[0], ...base.files.slice(1)] });
    expect(duplicate.ok).toBe(false);
    expect(duplicate.issues.join("\n")).toMatch(/duplicate path/);
    expect(verifyText({ ...base, schemaVersion: "2.0.0" }).issues.join("\n")).toMatch(/unsupported schema major/);
    expect(verifyText({ ...base, unexpected: true }).issues.join("\n")).toMatch(/unknown field/);
    expect(verifyText("[]").ok).toBe(false);
    expect(verifyText("").ok).toBe(false);
    expect(validateSyntheticRepositoryManifest(null).ok).toBe(false);

    const tampered = verifyText({ ...base, files: base.files.map((record, index) => (index === 1 ? { ...record, sha256: "0".repeat(64) } : record)) });
    expect(tampered.ok).toBe(false);
    expect(tampered.issues.join("\n")).toMatch(/sha256|repositoryContentIdentity/);
    const onDisk = path.join(first.repositoryRoot, base.files[1].path);
    const original = readFileSync(onDisk, "utf8");
    writeFileSync(onDisk, `${original}// changed on disk\n`);
    const changedFile = verifyText(base);
    expect(changedFile.ok).toBe(false);
    expect(changedFile.issues.join("\n")).toMatch(/sha256 .* does not match the manifest/);
    expect(readFileSync(onDisk, "utf8")).toBe(`${original}// changed on disk\n`);
    writeFileSync(onDisk, original);
    const missing = verifyText({ ...base, files: base.files.map((record, index) => (index === 1 ? { ...record, path: `${record.path}.gone`, } : record)) });
    expect(missing.ok).toBe(false);
    const dimension = verifyText({ ...base, realizedDimensions: { ...base.realizedDimensions, symbolCount: base.realizedDimensions.symbolCount + 1 } });
    expect(dimension.ok).toBe(false);
    expect(dimension.issues.join("\n")).toMatch(/symbolCount/);
    const aggregate = verifyText({ ...base, aggregate: { ...base.aggregate, totalBytes: base.aggregate.totalBytes + 1 } });
    expect(aggregate.ok).toBe(false);
    const identity = verifyText({ ...base, repositoryContentIdentity: "f".repeat(64) });
    expect(identity.ok).toBe(false);
    expect(verifyText(base).ok).toBe(true);
  });

  it("rejects an invalid plan (absolute path, traversal segment, dimension drift) before touching the output root", () => {
    const base = planFor();
    const clone = (): SyntheticRepositoryPlanV1 => JSON.parse(JSON.stringify(base)) as SyntheticRepositoryPlanV1;
    const absolute = clone();
    absolute.modules[0].path = "/abs/mod_00001.ts";
    const traversal = clone();
    traversal.modules[0].path = "src/../../escape.ts";
    const drift = clone();
    drift.requested.symbolCount += 1;
    const missingEdge = clone();
    missingEdge.importEdges.pop();
    const target = path.join(root, "never-created");
    for (const bad of [absolute, traversal, drift, missingEdge]) {
      expect(failure(() => materializeSyntheticRepository(bad, target)).code).toBe("invalid-plan");
    }
    expect(existsSync(target)).toBe(false);
  });

  it("works when the physical output root contains spaces and keeps logical identity independent of the root", () => {
    const spaced = path.join(root, "output dir with spaces");
    const other = path.join(root, "second root");
    const plan = planFor({ language: "python" });
    const first = materializeSyntheticRepository(plan, spaced);
    const second = materializeSyntheticRepository(plan, other);
    expect(first.manifest).toEqual(second.manifest);
    expect(readFileSync(first.manifestPath, "utf8")).toBe(readFileSync(second.manifestPath, "utf8"));
    expect(first.evaluationCase.targetRoot).toBe(second.evaluationCase.targetRoot);
    expect(first.evaluationCase.absoluteTargetRoot).not.toBe(second.evaluationCase.absoluteTargetRoot);
    if (process.platform === "win32") {
      const mixed = materializeSyntheticRepository(plan, `${root.split(path.sep).join("/")}/mixed/separators`);
      const backslashed = materializeSyntheticRepository(plan, path.join(root, "back", "slash"));
      expect(mixed.manifest.repositoryContentIdentity).toBe(backslashed.manifest.repositoryContentIdentity);
      expect(mixed.manifest.generationIdentity).toBe(plan.generationIdentity);
    }
  });

  it("rejects an output child that is a symlink escaping the output root without writing outside", () => {
    const outside = makeTempRoot("synthetic outside ");
    try {
      const plan = planFor();
      mkdirSync(root, { recursive: true });
      try {
        symlinkSync(outside, path.join(root, plan.caseId), process.platform === "win32" ? "junction" : "dir");
      } catch {
        return; // symlinks/junctions unavailable on this filesystem; nothing to assert
      }
      const error = failure(() => materializeSyntheticRepository(plan, root));
      expect(["path-escape", "collision"]).toContain(error.code);
      expect(readdirSync(outside)).toEqual([]);
      expect(lstatSync(path.join(root, plan.caseId)).isSymbolicLink()).toBe(true);
    } finally {
      removeTempRoot(outside);
    }
  });

  it("cleans only its own staging directory when a write fails and leaves siblings and the root untouched", () => {
    const sibling = materializeSyntheticRepository(planFor({ id: "sibling-case" }), root);
    const before = snapshot(root);
    const marker = path.join(root, "unrelated.txt");
    writeFileSync(marker, "keep\n");
    const plan = planFor({ id: "failing-case" });
    let writes = 0;
    const error = failure(() =>
      materializeSyntheticRepository(plan, root, {
        writeFile: (absolutePath, bytes) => {
          writes += 1;
          if (writes === 3) throw new Error("injected write failure");
          writeFileSync(absolutePath, bytes, { flag: "wx" });
        },
      })
    );
    expect(error.code).toBe("io-failure");
    expect(error.message).toMatch(/injected write failure/);
    expect(writes).toBe(3);
    expect(readdirSync(root).sort()).toEqual(["sibling-case", "unrelated.txt"]);
    expect(readFileSync(marker, "utf8")).toBe("keep\n");
    expect({ ...snapshot(root), "unrelated.txt": undefined }).toEqual({ ...before, "unrelated.txt": undefined });
    expect(verifySyntheticRepositoryMaterialization({ manifestPath: sibling.manifestPath, repositoryRoot: sibling.repositoryRoot }).ok).toBe(true);
    expect(existsSync(root)).toBe(true);
    // a later attempt for the same plan succeeds: no half-written destination was left behind
    expect(materializeSyntheticRepository(plan, root).reusedExistingMaterialization).toBe(false);
  });

  it("realizes exactly the requested dimensions, measured independently from the files", () => {
    const table: Array<[string, Partial<SyntheticRepositoryCaseSpecV1>]> = [
      ["small-ts", { language: "typescript", sourceFileCount: 4, moduleDepth: 2, internalImportCount: 3, symbolCount: 6, testFileCount: 2, repeatedPatternCount: 2 }],
      ["small-py", { language: "python", sourceFileCount: 4, moduleDepth: 2, internalImportCount: 3, symbolCount: 6, testFileCount: 2, repeatedPatternCount: 2 }],
      ["flat", { sourceFileCount: 5, moduleDepth: 1, internalImportCount: 0, symbolCount: 5, testFileCount: 0, repeatedPatternCount: 0 }],
      ["sparse-deep", { sourceFileCount: 14, moduleDepth: 7, internalImportCount: 8, symbolCount: 28, testFileCount: 4, repeatedPatternCount: 6 }],
      ["dense", { language: "python", sourceFileCount: 8, moduleDepth: 4, internalImportCount: 20, symbolCount: 24, testFileCount: 12, repeatedPatternCount: 13 }],
      ["no-tests", { language: "python", sourceFileCount: 6, moduleDepth: 3, internalImportCount: 6, symbolCount: 9, testFileCount: 0, repeatedPatternCount: 4 }],
      ["localized", { taskLocality: "localized", sourceFileCount: 6, moduleDepth: 3, internalImportCount: 6, symbolCount: 9 }],
      ["cross", { taskLocality: "cross-module", sourceFileCount: 6, moduleDepth: 3, internalImportCount: 6, symbolCount: 9 }],
      ["broad", { taskLocality: "broad-change", sourceFileCount: 9, moduleDepth: 3, internalImportCount: 10, symbolCount: 18 }],
    ];
    for (const [label, overrides] of table) {
      const plan = planSyntheticRepositoryCase(makeCase({ id: label, seed: label, ...overrides }));
      const result = materializeSyntheticRepository(plan, root);
      const measured = measureRepository(plan.language, readTree(result.repositoryRoot));
      expect(measured, label).toEqual({
        sourceFileCount: overrides.sourceFileCount ?? 4,
        moduleDepth: overrides.moduleDepth ?? 2,
        internalImportCount: overrides.internalImportCount ?? 3,
        symbolCount: overrides.symbolCount ?? 8,
        testFileCount: overrides.testFileCount ?? 2,
        repeatedPatternCount: overrides.repeatedPatternCount ?? 3,
      });
      expect(result.manifest.requestedDimensions).toEqual(measured);
      expect(result.manifest.realizedDimensions).toEqual(measured);
      expect(result.evaluationCase.taskLocality).toBe(overrides.taskLocality ?? "localized");
    }
  });

  it("materializes a maximum-bound plan within the default test timeout (single bounded feasibility smoke)", () => {
    const plan = planSyntheticRepositoryCase(
      makeCase({
        id: "max-case",
        sourceFileCount: 10000,
        moduleDepth: 64,
        internalImportCount: 100000,
        symbolCount: 100000,
        testFileCount: 10000,
        repeatedPatternCount: 100000,
      })
    );
    const result = materializeSyntheticRepository(plan, root);
    expect(result.manifest.aggregate.sourceFileCount).toBe(10000);
    expect(result.manifest.aggregate.testFileCount).toBe(10000);
    expect(result.manifest.realizedDimensions).toEqual(result.manifest.requestedDimensions);
    expect(result.manifest.realizedDimensions.moduleDepth).toBe(64);
    expect(result.manifest.files).toHaveLength(10000 + 10000 + 2);
    // Measured at ~21 s locally (rendering, hashing, staged write, verification of 20 002 files); the per-test
    // timeout leaves headroom for slower machines without changing the global test timeout.
  }, 180_000);
});
