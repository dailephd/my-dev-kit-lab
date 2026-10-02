import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SUBSYSTEM_DIR = fileURLToPath(new URL("../../../src/evaluation/syntheticRepository/", import.meta.url));
const EVALUATION_INDEX = fileURLToPath(new URL("../../../src/evaluation/index.ts", import.meta.url));

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1");
}

const allFiles = readdirSync(SUBSYSTEM_DIR)
  .filter((name) => name.endsWith(".ts"))
  .sort();

// Batch 1 (pure planning) files keep the strict purity contract. Batch 2 added rendering, manifest,
// verification, materialization and the EvaluationCase adapter; only the two filesystem owners may touch node:fs.
const files = ["config.ts", "identity.ts", "index.ts", "planning.ts", "prng.ts", "topology.ts", "types.ts"];
/** Import/export-from statements at the start of a line; ignores string or regex literals that merely contain "from". */
const IMPORT_STATEMENT = /^(?:import|export)\s[^"';]*?from\s+["']([^"']+)["']/gm;
const BATCH2_PURE_FILES =["evaluationCase.ts", "inspection.ts", "layout.ts", "manifest.ts", "renderPython.ts", "renderRepository.ts", "renderShared.ts", "renderTypeScript.ts"];
const BATCH2_FILESYSTEM_FILES = ["manifestVerification.ts", "materialize.ts"];

describe("synthetic repository source purity", () => {
  it("scans every production file in the subsystem", () => {
    expect(allFiles).toEqual([...files, ...BATCH2_PURE_FILES, ...BATCH2_FILESYSTEM_FILES].sort());
  });

  it("Batch 2 pure owners (rendering, inspection, layout, manifest, adapter) import no filesystem or process facility", () => {
    const allowed = new Set(["node:crypto", "node:path", "../types.js", "../../core/countTokens.js"]);
    for (const name of BATCH2_PURE_FILES) {
      const code = stripComments(readFileSync(`${SUBSYSTEM_DIR}${name}`, "utf8"));
      for (const match of code.matchAll(IMPORT_STATEMENT)) {
        expect(allowed.has(match[1]) || /^\.\/[A-Za-z]+\.js$/.test(match[1]), `${name} imports ${match[1]}`).toBe(true);
      }
      for (const forbidden of [/node:fs/, /node:child_process/, /node:os/, /process\./, /\bDate\b/, /Math\.random/, /writeFile/, /mkdir/, /\brmSync\b/]) {
        expect(code, `${name} ${forbidden}`).not.toMatch(forbidden);
      }
    }
  });

  it("Batch 2 filesystem owners reuse path safety, never shell out, and read no clock, cwd or randomness", () => {
    const allowed = new Set(["node:fs", "node:path", "../types.js", "../../core/pathSafety.js"]);
    for (const name of BATCH2_FILESYSTEM_FILES) {
      const code = stripComments(readFileSync(`${SUBSYSTEM_DIR}${name}`, "utf8"));
      for (const match of code.matchAll(IMPORT_STATEMENT)) {
        expect(allowed.has(match[1]) || /^\.\/[A-Za-z]+\.js$/.test(match[1]), `${name} imports ${match[1]}`).toBe(true);
      }
      for (const forbidden of [/node:child_process/, /node:os/, /process\.cwd/, /process\.env/, /\bDate\b/, /Math\.random/, /\bspawn|execFile|execSync/, /\bfetch\s*\(/]) {
        expect(code, `${name} ${forbidden}`).not.toMatch(forbidden);
      }
    }
    const materialize = stripComments(readFileSync(`${SUBSYSTEM_DIR}materialize.ts`, "utf8"));
    expect(materialize.match(/\brmSync\(/g)).toHaveLength(1);
    expect(materialize).toContain("rmSync(staging,");
    expect(readFileSync(`${SUBSYSTEM_DIR}manifestVerification.ts`, "utf8")).not.toMatch(/writeFile|mkdir|rmSync|renameSync/);
  });

  it("TST-044 imports only node:crypto, sibling modules and ../types.js", () => {
    for (const name of files) {
      const code = stripComments(readFileSync(`${SUBSYSTEM_DIR}${name}`, "utf8"));
      const specifiers = [...code.matchAll(/(?:from\s+|import\s+)["']([^"']+)["']/g)].map((match) => match[1]);
      for (const specifier of specifiers) {
        const allowed = specifier === "node:crypto" || /^\.\/[A-Za-z]+\.js$/.test(specifier) || specifier === "../types.js";
        expect(allowed, `${name} imports ${specifier}`).toBe(true);
      }
      expect(code, `${name} dynamic import`).not.toMatch(/\bimport\s*\(/);
      expect(code, `${name} require`).not.toMatch(/\brequire\s*\(/);
    }
  });

  it("TST-044 contains no filesystem, process, clock, randomness or subprocess tokens", () => {
    const forbidden: Array<[string, RegExp]> = [
      ["node:fs", /node:fs/],
      ["node:child_process", /node:child_process/],
      ["node:os", /node:os/],
      ['bare "fs"', /["']fs["']/],
      ["process.env", /process\.env/],
      ["process.cwd", /process\.cwd/],
      ["Date", /\bDate\b/],
      ["Math.random", /Math\.random/],
      ["writeFile", /writeFile/],
      ["mkdir", /mkdir/],
      ["spawn", /\bspawn|execFile|execSync/],
      ["fetch", /\bfetch\s*\(/],
    ];
    for (const name of files) {
      const code = stripComments(readFileSync(`${SUBSYSTEM_DIR}${name}`, "utf8"));
      for (const [label, pattern] of forbidden) expect(code, `${name} uses ${label}`).not.toMatch(pattern);
    }
  });

  it("TST-044 never imports other product subsystems and is not re-exported by src/evaluation/index.ts", () => {
    const banned = /(securityValidation|commands|cli|report|plots|gallery|experiments|screenshot|audits)/;
    for (const name of files) {
      const code = stripComments(readFileSync(`${SUBSYSTEM_DIR}${name}`, "utf8"));
      for (const match of code.matchAll(/from\s+["']([^"']+)["']/g)) {
        expect(match[1], `${name} imports ${match[1]}`).not.toMatch(banned);
      }
    }
    expect(readFileSync(EVALUATION_INDEX, "utf8")).not.toMatch(/syntheticRepository/);
  });
});
