import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SUBSYSTEM_DIR = fileURLToPath(new URL("../../../src/evaluation/syntheticRepository/", import.meta.url));
const EVALUATION_INDEX = fileURLToPath(new URL("../../../src/evaluation/index.ts", import.meta.url));

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1");
}

const files = readdirSync(SUBSYSTEM_DIR)
  .filter((name) => name.endsWith(".ts"))
  .sort();

describe("synthetic repository source purity", () => {
  it("scans every production file in the subsystem", () => {
    expect(files).toEqual(["config.ts", "identity.ts", "index.ts", "planning.ts", "prng.ts", "topology.ts", "types.ts"]);
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
