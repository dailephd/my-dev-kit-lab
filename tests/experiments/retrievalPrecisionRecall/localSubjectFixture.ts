import { chmodSync, copyFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import type { LocalSubjectFixture } from "../contextWindowScaling/localSubjectFixture.js";
import { createLocalSubjectFixture, readKitLog } from "../contextWindowScaling/localSubjectFixture.js";

export { readKitLog };

/** Distinguishable private values: none may ever appear in a durable external-local output file. */
export const RPR_MARKERS = {
  title: "RPR PRIVATE CASE TITLE SENTINEL",
  titleTwo: "RPR PRIVATE SECOND TITLE SENTINEL",
  symbol: "RprPrivateSymbolSentinelAlpha",
  symbolTwo: "RprPrivateSymbolSentinelBeta",
  fact: "rpr-private-fact-sentinel-one",
  factTwo: "rpr-private-fact-sentinel-two",
  factThree: "rpr-private-fact-sentinel-three",
  source: "RPR_SOURCE_BODY_SENTINEL_9d1c",
  stdout: "RPR_RAW_STDOUT_SENTINEL_44ab",
  stderr: "RPR_RAW_STDERR_SENTINEL_71ef",
  warning: "RPR_WARNING_PROSE_SENTINEL_0b8e"
} as const;

const FACT_TEXT = "private fact text that is never persisted";

/** Two cases with different source roots, a complete answer key and explicit fact mappings (required for coverage). */
export function rprLocalSubjectCases(): Record<string, unknown>[] {
  return [
    {
      id: "rpr-case-one",
      title: RPR_MARKERS.title,
      sourceRoots: ["src"],
      query: "Where are the private symbols defined?",
      expectedFiles: ["src/main.ts", "src/util/helper.ts"],
      expectedSymbols: [RPR_MARKERS.symbol, RPR_MARKERS.symbolTwo],
      rawIncludeGlobs: ["src/**/*"],
      taskLocality: "cross-module",
      answerKey: {
        expectedFiles: ["src/main.ts", "src/util/helper.ts"],
        expectedSymbols: [RPR_MARKERS.symbol, RPR_MARKERS.symbolTwo],
        expectedFacts: [
          { id: RPR_MARKERS.fact, text: FACT_TEXT, weight: 1, required: true },
          { id: RPR_MARKERS.factTwo, text: FACT_TEXT, weight: 1, required: true }
        ],
        expectedContextTargets: [
          { file: "src/main.ts", symbols: [RPR_MARKERS.symbol], required: true, factIds: [RPR_MARKERS.fact] },
          { file: "src/util/helper.ts", symbols: [RPR_MARKERS.symbolTwo], required: true, factIds: [RPR_MARKERS.factTwo] }
        ],
        minimumCorrectFacts: 1
      }
    },
    {
      id: "rpr-case-two",
      title: RPR_MARKERS.titleTwo,
      sourceRoots: ["src/util"],
      query: "Where is the helper defined?",
      expectedFiles: ["src/util/helper.ts"],
      expectedSymbols: [RPR_MARKERS.symbolTwo],
      rawIncludeGlobs: ["src/util/**/*"],
      taskLocality: "localized",
      answerKey: {
        expectedFiles: ["src/util/helper.ts"],
        expectedSymbols: [RPR_MARKERS.symbolTwo],
        expectedFacts: [{ id: RPR_MARKERS.factThree, text: FACT_TEXT, weight: 1, required: true }],
        expectedContextTargets: [{ file: "src/util/helper.ts", symbols: [RPR_MARKERS.symbolTwo], required: true, factIds: [RPR_MARKERS.factThree] }],
        minimumCorrectFacts: 1
      }
    }
  ];
}

export const OVER_DEFAULT_LIMIT = 1_048_576 + 100;

export function createRprLocalSubjectFixture(options: { cases?: Record<string, unknown>[] } = {}): Promise<LocalSubjectFixture> {
  return createLocalSubjectFixture({ cases: options.cases ?? rprLocalSubjectCases(), hugeFileBytes: OVER_DEFAULT_LIMIT });
}

/**
 * Copies the shared upstream-shaped fake my-dev-kit fixture (tests/fixtures/fake-upstream-shaped-kit-cli.js, which also
 * serves the packed-package gate) into a temp directory. Its environment-variable contract is documented in that file.
 */
export function writeUpstreamShapedKit(directory: string): { command: string; script: string } {
  mkdirSync(directory, { recursive: true });
  const script = path.join(directory, "upstream-shaped-kit.mjs");
  copyFileSync(path.resolve("tests/fixtures/fake-upstream-shaped-kit-cli.js"), script);
  chmodSync(script, 0o644);
  return { command: `${JSON.stringify(process.execPath)} ${JSON.stringify(script)}`, script };
}
