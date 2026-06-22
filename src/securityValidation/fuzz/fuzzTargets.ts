import path from "node:path";
import type { FuzzTarget } from "./fuzzHarness.js";
import type { Prng } from "./randomInput.js";
import {
  ALL_MUTATION_STRATEGIES,
  PATH_TRAVERSAL_INPUTS,
  mutateJson,
  randomChoice,
  randomInt,
  randomJsonString,
  randomString,
  validCodeGraphJson,
  validManifestJson,
} from "./randomInput.js";
import { parseNpmAudit } from "../dependencies/parseNpmAudit.js";
import { parseNpmLs } from "../dependencies/parseNpmLs.js";
import { parseNpmOutdated } from "../dependencies/parseNpmOutdated.js";
import { parseNpmPackDryRun } from "../packageChecks/parseNpmPackDryRun.js";
import { escapeDotLabel } from "../cliAdversarial/subprocessSafetyChecks.js";

// ---------------------------------------------------------------------------
// Fuzz targets — parsers, helpers, and path normalization
//
// Each target must not crash on any input. Expected validation errors are OK.
// Targets are designed to be pure functions — no filesystem, no network.
// ---------------------------------------------------------------------------

// Manifest reader — expects JSON with schemaVersion, generatedAt, rootDir, files
export const manifestReaderTarget: FuzzTarget = {
  id: "manifest-reader",
  name: "Manifest JSON parser",
  generateInput(prng: Prng, iteration: number): string {
    if (iteration % 3 === 0) return validManifestJson();
    const strategy = randomChoice(prng, ALL_MUTATION_STRATEGIES);
    return mutateJson(prng, validManifestJson(), strategy);
  },
  run(input: string): undefined | string {
    // The manifest reader is the JSON.parse step that produces structured data.
    // We replicate minimal parsing logic (same shape as what runAdversarialCheck does).
    try {
      JSON.parse(input);
    } catch {
      return "expected: invalid JSON";
    }
    return undefined;
  },
};

// Code-graph reader — expects JSON with nodes/edges arrays
export const codeGraphReaderTarget: FuzzTarget = {
  id: "code-graph-reader",
  name: "Code-graph JSON parser",
  generateInput(prng: Prng, iteration: number): string {
    if (iteration % 3 === 0) return validCodeGraphJson();
    const strategy = randomChoice(prng, ALL_MUTATION_STRATEGIES);
    return mutateJson(prng, validCodeGraphJson(), strategy);
  },
  run(input: string): undefined | string {
    try {
      const parsed = JSON.parse(input) as Record<string, unknown>;
      if (!Array.isArray(parsed["nodes"])) return "expected: missing nodes array";
      if (!Array.isArray(parsed["edges"])) return "expected: missing edges array";
    } catch {
      return "expected: invalid JSON";
    }
    return undefined;
  },
};

// npm audit JSON parser
export const npmAuditParserTarget: FuzzTarget = {
  id: "npm-audit-parser",
  name: "npm audit JSON parser",
  generateInput(prng: Prng, iteration: number): string {
    if (iteration % 5 === 0) {
      return JSON.stringify({
        auditReportVersion: 2,
        vulnerabilities: {},
        metadata: { vulnerabilities: { total: 0 } },
      });
    }
    const strategy = randomChoice(prng, ALL_MUTATION_STRATEGIES);
    return mutateJson(prng, randomJsonString(prng, 3), strategy);
  },
  run(input: string): undefined | string {
    parseNpmAudit(input, "fuzz-test");
    return undefined;
  },
};

// npm ls JSON parser
export const npmLsParserTarget: FuzzTarget = {
  id: "npm-ls-parser",
  name: "npm ls JSON parser",
  generateInput(prng: Prng, iteration: number): string {
    if (iteration % 5 === 0) {
      return JSON.stringify({
        name: "my-dev-kit-lab",
        version: "0.1.2",
        dependencies: {},
      });
    }
    const strategy = randomChoice(prng, ALL_MUTATION_STRATEGIES);
    return mutateJson(prng, randomJsonString(prng, 2), strategy);
  },
  run(input: string): undefined | string {
    parseNpmLs(input, "fuzz-test");
    return undefined;
  },
};

// npm outdated JSON parser
export const npmOutdatedParserTarget: FuzzTarget = {
  id: "npm-outdated-parser",
  name: "npm outdated JSON parser",
  generateInput(prng: Prng, iteration: number): string {
    if (iteration % 5 === 0) {
      return JSON.stringify({});
    }
    const strategy = randomChoice(prng, ALL_MUTATION_STRATEGIES);
    return mutateJson(prng, randomJsonString(prng, 2), strategy);
  },
  run(input: string): undefined | string {
    parseNpmOutdated(input, "fuzz-test");
    return undefined;
  },
};

// npm pack --dry-run output parser
export const npmPackDryRunParserTarget: FuzzTarget = {
  id: "npm-pack-dry-run-parser",
  name: "npm pack --dry-run output parser",
  generateInput(prng: Prng, iteration: number): string {
    if (iteration % 3 === 0) {
      return JSON.stringify([{
        id: "my-dev-kit-lab@0.1.2",
        name: "my-dev-kit-lab",
        version: "0.1.2",
        filename: "my-dev-kit-lab-0.1.2.tgz",
        files: [],
        entryCount: 0,
        bundled: [],
      }]);
    }
    return randomChoice(prng, ALL_MUTATION_STRATEGIES) === "replace-with-empty"
      ? ""
      : randomJsonString(prng, 2);
  },
  run(input: string): undefined | string {
    parseNpmPackDryRun(input);
    return undefined;
  },
};

// DOT label escaping — must never crash on any input
export const dotLabelEscapingTarget: FuzzTarget = {
  id: "dot-label-escaping",
  name: "DOT label escaping",
  generateInput(prng: Prng, _iteration: number): string {
    return randomString(prng, 256);
  },
  run(input: string): undefined | string {
    escapeDotLabel(input);
    return undefined;
  },
};

// Path normalization — path inputs must not produce unexpected crashes
export const pathNormalizationTarget: FuzzTarget = {
  id: "path-normalization",
  name: "Path normalization (traversal inputs)",
  generateInput(prng: Prng, iteration: number): string {
    if (iteration < PATH_TRAVERSAL_INPUTS.length) {
      return PATH_TRAVERSAL_INPUTS[iteration];
    }
    return randomChoice(prng, PATH_TRAVERSAL_INPUTS);
  },
  run(input: string): undefined | string {
    path.normalize(input);
    path.resolve("/base", input);
    return undefined;
  },
};

// Source windowing — negative, zero, huge, out-of-range window sizes
export const sourceWindowingTarget: FuzzTarget = {
  id: "source-windowing",
  name: "Source retrieval windowing (window size edge cases)",
  generateInput(prng: Prng, _iteration: number): string {
    const windowSizes = [-1, 0, 1, 5, 100, 10_000, Number.MAX_SAFE_INTEGER, NaN, Infinity];
    const size = randomChoice(prng, windowSizes);
    return JSON.stringify({ startLine: randomInt(prng, -10, 1000), windowSize: size });
  },
  run(input: string): undefined | string {
    try {
      const parsed = JSON.parse(input) as Record<string, unknown>;
      const startLine = Number(parsed["startLine"]);
      const windowSize = Number(parsed["windowSize"]);
      // Simulate windowing math — must not throw
      const safeStart = Math.max(0, isFinite(startLine) ? startLine : 0);
      const safeWindow = isFinite(windowSize) && windowSize > 0 ? Math.min(windowSize, 10_000) : 50;
      void (safeStart + safeWindow);
    } catch {
      return "expected: invalid input";
    }
    return undefined;
  },
};

export const ALL_FUZZ_TARGETS: FuzzTarget[] = [
  manifestReaderTarget,
  codeGraphReaderTarget,
  npmAuditParserTarget,
  npmLsParserTarget,
  npmOutdatedParserTarget,
  npmPackDryRunParserTarget,
  dotLabelEscapingTarget,
  pathNormalizationTarget,
  sourceWindowingTarget,
];
