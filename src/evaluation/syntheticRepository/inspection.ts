import path from "node:path";
import { REPEATED_PATTERN_MARKER } from "./renderShared.js";
import { pythonModuleName } from "./renderPython.js";
import type { SyntheticRepositoryLanguage } from "./types.js";

export type InspectableFile = { path: string; role: "source" | "test" | "support"; content: string };

export type InspectedDimensions = {
  sourceFileCount: number;
  moduleDepth: number;
  internalImportCount: number;
  symbolCount: number;
  testFileCount: number;
  repeatedPatternCount: number;
};

export type RepositoryInspection = {
  dimensions: InspectedDimensions;
  /** Resolved internal source-module import edges as "from-path -> to-path", sorted. */
  importEdges: string[];
  symbolNames: string[];
  issues: string[];
};

const TS_SYMBOL = /^export function (sym_\d+)\(/gm;
const PY_SYMBOL = /^def (sym_\d+)\(/gm;
const TS_IMPORT = /^import \{ (sym_\d+) \} from "([^"]+)";$/gm;
const PY_IMPORT = /^from ([A-Za-z0-9_.]+) import (sym_\d+)$/gm;
const PATTERN = new RegExp(`${REPEATED_PATTERN_MARKER} (pattern_\\d+) `, "g");

function matchAll(pattern: RegExp, text: string): RegExpMatchArray[] {
  return [...text.matchAll(new RegExp(pattern.source, pattern.flags))];
}

/**
 * Measures a generated repository from its file bytes alone (no plan): file roles, `sym_` definitions,
 * resolved internal imports, repeated-pattern markers and the longest dependency chain. The verifier and the
 * renderer self-check use it so requested dimensions are compared with what the files really contain.
 */
export function inspectRepositoryFiles(language: SyntheticRepositoryLanguage, files: readonly InspectableFile[]): RepositoryInspection {
  const issues: string[] = [];
  const sources = files.filter((file) => file.role === "source");
  const tests = files.filter((file) => file.role === "test");
  const sourcePaths = new Set(sources.map((file) => file.path));
  const pathByModuleName = new Map<string, string>();
  if (language === "python") {
    for (const source of sources) pathByModuleName.set(pythonModuleName(source.path), source.path);
  }

  const symbolNames: string[] = [];
  let patterns = 0;
  const edges = new Set<string>();
  const outgoing = new Map<string, string[]>(sources.map((file) => [file.path, []] as const));
  for (const source of sources) {
    for (const match of matchAll(language === "typescript" ? TS_SYMBOL : PY_SYMBOL, source.content)) symbolNames.push(match[1]);
    patterns += matchAll(PATTERN, source.content).length;
    for (const match of matchAll(language === "typescript" ? TS_IMPORT : PY_IMPORT, source.content)) {
      const target =
        language === "typescript"
          ? path.posix.join(path.posix.dirname(source.path), match[2]).replace(/\.js$/, ".ts")
          : pathByModuleName.get(match[1]);
      if (target === undefined || !sourcePaths.has(target)) {
        issues.push(`${source.path}: import ${JSON.stringify(match[0])} does not resolve to a source module.`);
        continue;
      }
      if (target === source.path) issues.push(`${source.path}: imports itself.`);
      const key = `${source.path} -> ${target}`;
      if (edges.has(key)) issues.push(`${source.path}: duplicate import of ${target}.`);
      edges.add(key);
      outgoing.get(source.path)?.push(target);
    }
  }
  for (const other of [...tests, ...files.filter((file) => file.role === "support")]) {
    if (matchAll(PATTERN, other.content).length > 0) issues.push(`${other.path}: ${other.role} file contains a repeated-pattern marker.`);
  }
  if (new Set(symbolNames).size !== symbolNames.length) issues.push("duplicate sym_ definition names.");

  const longest = new Map<string, number>();
  const visiting = new Set<string>();
  const visit = (node: string): number => {
    const known = longest.get(node);
    if (known !== undefined) return known;
    if (visiting.has(node)) {
      issues.push("import graph contains a cycle.");
      return 0;
    }
    visiting.add(node);
    let best = 1;
    for (const next of outgoing.get(node) ?? []) best = Math.max(best, 1 + visit(next));
    visiting.delete(node);
    longest.set(node, best);
    return best;
  };
  let moduleDepth = 0;
  for (const source of sources) moduleDepth = Math.max(moduleDepth, visit(source.path));

  return {
    dimensions: {
      sourceFileCount: sources.length,
      moduleDepth,
      internalImportCount: edges.size,
      symbolCount: symbolNames.length,
      testFileCount: tests.length,
      repeatedPatternCount: patterns,
    },
    importEdges: [...edges].sort(),
    symbolNames,
    issues,
  };
}
