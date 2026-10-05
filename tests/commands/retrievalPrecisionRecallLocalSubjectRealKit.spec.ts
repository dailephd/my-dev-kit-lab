import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { checkRetrievalRedactionTruthfulness, scanDurableOutputDirectory, type PrivacySentinel } from "../../scripts/externalLocalPrivacyScan.js";
import { runExperimentRunCommandFromArgs } from "../../src/commands/runExperimentRunCommand.js";
import { createLabExecutionContext } from "../../src/runtime/index.js";
import { makeTempDir, removeTempDir } from "../evaluation/localRepositorySubject/fixtureRepository.js";
import { createLocalSubjectFixture, git, listTree } from "../experiments/contextWindowScaling/localSubjectFixture.js";
import type { LocalSubjectFixture } from "../experiments/contextWindowScaling/localSubjectFixture.js";
import { OVER_DEFAULT_LIMIT, RPR_MARKERS, rprLocalSubjectCases } from "../experiments/retrievalPrecisionRecall/localSubjectFixture.js";

/**
 * Opt-in smoke of the PUBLIC external-local retrieval-precision-recall command with the real published my-dev-kit
 * CLI (needs the package installed or fetchable, so it is not part of the offline default suite). It checks
 * composition only: command compatibility, per-case indexing, execution, target immutability, scratch cleanup and
 * privacy-safe output. It asserts no retrieval-quality threshold: low precision or recall is a valid measurement.
 *   LAB_REAL_MY_DEV_KIT=1 LAB_REAL_MY_DEV_KIT_COMMAND="npx --yes @dailephd/my-dev-kit@<version>" \
 *     npx vitest run tests/commands/retrievalPrecisionRecallLocalSubjectRealKit.spec.ts
 */
const enabled = Boolean(process.env.LAB_REAL_MY_DEV_KIT);
const kitCommand = process.env.LAB_REAL_MY_DEV_KIT_COMMAND || "npx @dailephd/my-dev-kit@latest";
vi.setConfig({ testTimeout: 900_000, hookTimeout: 900_000 });

let fixture: LocalSubjectFixture;
let extra: string[];
beforeEach(async () => {
  if (!enabled) return;
  extra = [];
  fixture = await createLocalSubjectFixture({
    cases: rprLocalSubjectCases(),
    hugeFileBytes: OVER_DEFAULT_LIMIT,
    // Real definitions of the private symbols, so the upstream tool has something genuine to find.
    extraFiles: {
      "src/main.ts": `export function ${RPR_MARKERS.symbol}(): string {\n  return "${RPR_MARKERS.source}";\n}\n`,
      "src/util/helper.ts": `export function ${RPR_MARKERS.symbolTwo}(value: number): number {\n  return value + 1;\n}\n`
    }
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  if (!enabled) return;
  for (const directory of [...fixture.directories, ...extra]) removeTempDir(directory);
});

function walk(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => (entry.isDirectory() ? walk(path.join(directory, entry.name)) : [path.join(directory, entry.name)]))
    .map((file) => path.relative(directory, file).replace(/\\/g, "/"))
    .sort();
}

describe.skipIf(!enabled)("public external-local retrieval-precision-recall with the real my-dev-kit", () => {
  it("composes: indexes each case, runs, leaves the target unchanged, cleans scratch, and writes privacy-safe output", async () => {
    const parent = makeTempDir("rpr-b4-real-");
    extra.push(parent);
    const configPath = path.join(parent, "local-subject.json");
    writeFileSync(configPath, JSON.stringify({ schemaVersion: "1.0.0", subjectId: "rpr-real-subject", cases: rprLocalSubjectCases() }));
    const outDir = path.join(parent, "run");
    const treeBefore = listTree(fixture.root);
    const statusBefore = git(fixture.root, "status", "--porcelain=v1");
    const logs: string[] = [];
    const errors: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...a) => void logs.push(a.join(" ")));
    vi.spyOn(console, "error").mockImplementation((...a) => void errors.push(a.join(" ")));

    const code = await runExperimentRunCommandFromArgs(
      ["--experiment", "retrieval-precision-recall", "--target", fixture.root, "--local-subject-config", configPath, "--kit-command", kitCommand, "--out", outDir],
      { context: createLabExecutionContext({ invocationCwd: process.cwd() }) }
    );
    expect(code, `${errors.join("\n")}\n${logs.join("\n")}`).toBe(0);
    expect(logs.join("\n")).toMatch(/Status: (completed|partial)/);
    expect(logs.join("\n")).toContain("Mode: external-local repository subject");

    expect(listTree(fixture.root)).toEqual(treeBefore);
    expect(git(fixture.root, "status", "--porcelain=v1")).toBe(statusBefore);
    expect(existsSync(path.join(fixture.root, ".my-dev-kit"))).toBe(false);
    expect(readdirSync(outDir).some((entry) => /^s-/.test(entry))).toBe(false);
    expect(walk(outDir)).toEqual([
      "local-repository-subject-manifest.json",
      "report.html",
      "report.json",
      "report.txt",
      "retrieval-precision-recall-execution.json"
    ]);

    const artifact = JSON.parse(readFileSync(path.join(outDir, "retrieval-precision-recall-execution.json"), "utf8"));
    expect(artifact.cases.map((entry: { caseId: string }) => entry.caseId)).toEqual(["rpr-case-one", "rpr-case-two"]);
    expect(checkRetrievalRedactionTruthfulness(artifact)).toEqual([]);
    console.info(`real-kit scientific status: ${artifact.cases.map((entry: { caseId: string; status: string }) => `${entry.caseId}=${entry.status}`).join(", ")}; fact coverage available for ${artifact.aggregate.ratios.factCoverage.availableCount} case(s)`);

    const variants = (value: string): PrivacySentinel => ({ label: "private path", value, kind: "path" });
    const sentinels: PrivacySentinel[] = [
      ...[fixture.root, path.dirname(fixture.root), fixture.workRoot, parent, outDir, os.homedir()].map(variants),
      ...[...Object.values(RPR_MARKERS), path.basename(fixture.root), "src/main.ts", "src/util/helper.ts", "helper.ts", "ignored.ts", "gen/out", "huge.ts", "linked.ts", "ELIGIBLE_MARKER_7f3a", "IGNORED_FILE_MARKER_91bc", "OVERSIZED_MARKER_55aa", "SYMLINK_TARGET_MARKER_c0de"].map(
        (value): PrivacySentinel => ({ label: "private text", value, kind: "text" })
      )
    ];
    expect(scanDurableOutputDirectory(outDir, sentinels)).toEqual([]);
  });
});
