import { readFileSync, readdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import type { PrivacySentinel } from "../../../scripts/externalLocalPrivacyScan.js";
import { createLocalSubjectFixture, readKitLog } from "../contextWindowScaling/localSubjectFixture.js";
import { OVER_DEFAULT_LIMIT } from "../retrievalPrecisionRecall/localSubjectFixture.js";
import type { LocalSubjectFixture } from "../contextWindowScaling/localSubjectFixture.js";

export { readKitLog };

/** Distinguishable private values: none may ever appear in a durable external-local output file. */
export const CPG_MARKERS = {
  title: "CPG PRIVATE CASE TITLE SENTINEL",
  titleTwo: "CPG PRIVATE SECOND TITLE SENTINEL",
  query: "CPG_PRIVATE_QUERY_SENTINEL_aa11",
  queryTwo: "CPG_PRIVATE_SECOND_QUERY_SENTINEL_bb22",
  engineSymbol: "ZetaPrivateEngineStart",
  helperSymbol: "zetaPrivateHelperRoutine",
  fact: "cpg-private-fact-sentinel-one",
  factTwo: "cpg-private-fact-sentinel-two",
  factThree: "cpg-private-fact-sentinel-three",
  engineSource: "ZETA_SOURCE_BODY_SENTINEL_5c2d",
  helperSource: "ZETA_HELPER_BODY_SENTINEL_77aa",
  testSource: "ZETA_TEST_BODY_SENTINEL_19ef",
  stderr: "CPG_RAW_STDERR_SENTINEL_9b3a",
  engineFile: "src/zeta-private/ZetaPrivateEngine.ts",
  helperFile: "src/zeta-private/zeta-private-helper.ts",
  testFile: "src/zeta-private/ZetaPrivateEngine.test.ts"
} as const;

const FACT_TEXT = "private fact text that is never persisted";

const ENGINE_SOURCE = `export function ${CPG_MARKERS.engineSymbol}(): string {\n  const bodyLine = "${CPG_MARKERS.engineSource}";\n  return bodyLine;\n}\n`;
const HELPER_SOURCE = `export function ${CPG_MARKERS.helperSymbol}(): number {\n  const helperLine = "${CPG_MARKERS.helperSource}";\n  return helperLine.length;\n}\n`;
const TEST_SOURCE = `import { ${CPG_MARKERS.engineSymbol} } from "./ZetaPrivateEngine.js"; // ${CPG_MARKERS.testSource}\n`;

/** Two cases with different source roots, complete answer keys and explicit fact mappings. */
export function cpgLocalSubjectCases(): Record<string, unknown>[] {
  return [
    {
      id: "cpg-case-one",
      title: CPG_MARKERS.title,
      sourceRoots: ["src"],
      query: `Where does the engine start? ${CPG_MARKERS.query}`,
      expectedFiles: [CPG_MARKERS.engineFile, CPG_MARKERS.helperFile],
      expectedSymbols: [CPG_MARKERS.engineSymbol, CPG_MARKERS.helperSymbol],
      rawIncludeGlobs: ["src/**/*"],
      taskLocality: "cross-module",
      answerKey: {
        expectedFiles: [CPG_MARKERS.engineFile, CPG_MARKERS.helperFile],
        expectedSymbols: [CPG_MARKERS.engineSymbol, CPG_MARKERS.helperSymbol],
        expectedFacts: [
          { id: CPG_MARKERS.fact, text: FACT_TEXT, weight: 1, required: true },
          { id: CPG_MARKERS.factTwo, text: FACT_TEXT, weight: 1, required: true }
        ],
        expectedContextTargets: [
          { file: CPG_MARKERS.engineFile, symbols: [CPG_MARKERS.engineSymbol], required: true, factIds: [CPG_MARKERS.fact] },
          { file: CPG_MARKERS.helperFile, symbols: [CPG_MARKERS.helperSymbol], required: true, factIds: [CPG_MARKERS.factTwo] }
        ],
        minimumCorrectFacts: 1
      }
    },
    {
      id: "cpg-case-two",
      title: CPG_MARKERS.titleTwo,
      sourceRoots: ["src/zeta-private"],
      query: `Where is the helper? ${CPG_MARKERS.queryTwo}`,
      expectedFiles: [CPG_MARKERS.helperFile],
      expectedSymbols: [CPG_MARKERS.helperSymbol],
      rawIncludeGlobs: ["src/zeta-private/**/*"],
      taskLocality: "localized",
      answerKey: {
        expectedFiles: [CPG_MARKERS.helperFile],
        expectedSymbols: [CPG_MARKERS.helperSymbol],
        expectedFacts: [{ id: CPG_MARKERS.factThree, text: FACT_TEXT, weight: 1, required: true }],
        expectedContextTargets: [{ file: CPG_MARKERS.helperFile, symbols: [CPG_MARKERS.helperSymbol], required: true, factIds: [CPG_MARKERS.factThree] }],
        minimumCorrectFacts: 1
      }
    }
  ];
}

export function createCpgLocalSubjectFixture(options: { cases?: Record<string, unknown>[] } = {}): Promise<LocalSubjectFixture> {
  return createLocalSubjectFixture({
    cases: options.cases ?? cpgLocalSubjectCases(),
    hugeFileBytes: OVER_DEFAULT_LIMIT,
    extraFiles: {
      [CPG_MARKERS.engineFile]: ENGINE_SOURCE,
      [CPG_MARKERS.helperFile]: HELPER_SOURCE,
      [CPG_MARKERS.testFile]: TEST_SOURCE
    }
  });
}

/** Command string for the fake kit; the script path is resolved from the repository root the tests run in. */
export function cpgKitCommand(): string {
  const script = path.resolve("tests/experiments/contextPackGeneration/fakeContextPackKit.mjs");
  return `${JSON.stringify(process.execPath)} ${JSON.stringify(script)}`;
}

export const CPG_KIT_ENV = ["CPG_KIT_LOG", "CPG_KIT_MUTATE_FILE", "CPG_KIT_INDEX_FAIL", "CPG_KIT_SEARCH_FAIL", "CPG_KIT_SEARCH_EXTRA"] as const;

export function clearCpgKitEnv(): void {
  for (const name of CPG_KIT_ENV) delete process.env[name];
}

/** Content hash of every non-.git file below a directory, for byte-for-byte before/after comparison. */
export function hashTree(directory: string): Record<string, string> {
  const hashes: Record<string, string> = {};
  const walk = (current: string, prefix: string): void => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      if (entry.name === ".git") continue;
      const relative = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
      if (entry.isDirectory()) walk(path.join(current, entry.name), relative);
      else hashes[relative] = createHash("sha256").update(readFileSync(path.join(current, entry.name))).digest("hex");
    }
  };
  walk(directory, "");
  return hashes;
}

/** Every private value a durable external-local output must never contain (paths in every separator form, identities, source). */
export function cpgPrivateSentinels(args: { root: string; workRoot: string; outDir: string; logPath: string }): PrivacySentinel[] {
  const scratchPaths = readKitLog(args.logPath)
    .filter((entry) => entry.argv[0] === "index" && entry.argv.includes("--out"))
    .map((entry) => entry.argv[entry.argv.indexOf("--out") + 1])
    .filter((value): value is string => typeof value === "string" && path.isAbsolute(value));
  const paths = [
    args.root,
    path.dirname(args.root),
    args.workRoot,
    args.outDir,
    path.dirname(args.outDir),
    process.cwd(),
    os.homedir(),
    os.tmpdir(),
    ...scratchPaths,
    ...scratchPaths.map((value) => path.dirname(value))
  ];
  const texts = [
    CPG_MARKERS.title,
    CPG_MARKERS.titleTwo,
    CPG_MARKERS.query,
    CPG_MARKERS.queryTwo,
    CPG_MARKERS.engineSymbol,
    CPG_MARKERS.helperSymbol,
    CPG_MARKERS.fact,
    CPG_MARKERS.factTwo,
    CPG_MARKERS.factThree,
    CPG_MARKERS.engineSource,
    CPG_MARKERS.helperSource,
    CPG_MARKERS.testSource,
    CPG_MARKERS.stderr,
    CPG_MARKERS.engineFile,
    CPG_MARKERS.helperFile,
    CPG_MARKERS.testFile,
    "ZetaPrivateEngine",
    "zeta-private-helper",
    `symbol:${CPG_MARKERS.engineFile}`,
    `file:${CPG_MARKERS.testFile}`,
    path.basename(args.root),
    "src/main.ts",
    "src/util/helper.ts",
    "ELIGIBLE_MARKER_7f3a",
    "IGNORED_FILE_MARKER_91bc",
    "OVERSIZED_MARKER_55aa",
    "SYMLINK_TARGET_MARKER_c0de",
    "fakeContextPackKit"
  ];
  return [
    ...paths.map((value) => ({ label: "private path", value, kind: "path" as const })),
    ...texts.map((value) => ({ label: "private text", value, kind: "text" as const }))
  ];
}
