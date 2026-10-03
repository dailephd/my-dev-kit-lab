import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";

/**
 * Test-side, independent measurement of a generated repository. It shares no code with the production
 * inspection or verification modules: files are read from disk (or a file list), lines are scanned with
 * string operations and the dependency depth is found with a Kahn topological pass.
 */
export type MeasuredFile = { path: string; content: string };

export type MeasuredDimensions = {
  sourceFileCount: number;
  moduleDepth: number;
  internalImportCount: number;
  symbolCount: number;
  testFileCount: number;
  repeatedPatternCount: number;
};

export function readTree(root: string): MeasuredFile[] {
  const files: MeasuredFile[] = [];
  const walk = (directory: string): void => {
    for (const entry of readdirSync(directory).sort()) {
      const full = path.join(directory, entry);
      if (statSync(full).isDirectory()) walk(full);
      else files.push({ path: path.relative(root, full).split(path.sep).join("/"), content: readFileSync(full, "utf8") });
    }
  };
  walk(root);
  return files;
}

export function sha256Of(content: string): string {
  return createHash("sha256").update(Buffer.from(content, "utf8")).digest("hex");
}

export function measureRepository(language: "typescript" | "python", files: readonly MeasuredFile[]): MeasuredDimensions {
  const isSource = (file: MeasuredFile): boolean => file.path.startsWith("src/") && file.path.endsWith(language === "typescript" ? ".ts" : ".py");
  const isTest = (file: MeasuredFile): boolean => file.path.startsWith("tests/");
  const sources = files.filter(isSource);
  const tests = files.filter(isTest);
  let symbols = 0;
  let patterns = 0;
  const importer = new Map<string, Set<string>>(sources.map((file) => [file.path, new Set<string>()] as const));
  for (const source of sources) {
    for (const line of source.content.split("\n")) {
      if (language === "typescript" && line.startsWith("export function sym_")) symbols += 1;
      if (language === "python" && line.startsWith("def sym_")) symbols += 1;
      if (line.includes("@synthetic-pattern ")) patterns += 1;
      if (language === "typescript" && line.startsWith("import {")) {
        const specifier = line.slice(line.indexOf('"') + 1, line.lastIndexOf('"'));
        const target = path.posix.normalize(path.posix.join(path.posix.dirname(source.path), specifier.replace(/\.js$/, ".ts")));
        importer.get(source.path)?.add(target);
      }
      if (language === "python" && line.startsWith("from ")) {
        const moduleName = line.split(" ")[1];
        importer.get(source.path)?.add(`src/${moduleName.split(".").join("/")}.py`);
      }
    }
  }
  let edges = 0;
  const indegree = new Map<string, number>(sources.map((file) => [file.path, 0] as const));
  for (const [, targets] of importer) {
    for (const target of targets) {
      edges += 1;
      indegree.set(target, (indegree.get(target) ?? 0) + 1);
    }
  }
  // Kahn pass from the importers: depth[n] = longest chain (in modules) starting at n.
  const order: string[] = [];
  const remaining = new Map(indegree);
  const queue = [...remaining].filter(([, degree]) => degree === 0).map(([name]) => name);
  while (queue.length > 0) {
    const current = queue.shift() as string;
    order.push(current);
    for (const target of importer.get(current) ?? []) {
      remaining.set(target, (remaining.get(target) ?? 0) - 1);
      if (remaining.get(target) === 0) queue.push(target);
    }
  }
  if (order.length !== sources.length) throw new Error("test oracle: generated import graph is cyclic or dangling");
  const depth = new Map<string, number>();
  for (const name of [...order].reverse()) {
    let best = 1;
    for (const target of importer.get(name) ?? []) best = Math.max(best, 1 + (depth.get(target) as number));
    depth.set(name, best);
  }
  return {
    sourceFileCount: sources.length,
    moduleDepth: Math.max(0, ...depth.values()),
    internalImportCount: edges,
    symbolCount: symbols,
    testFileCount: tests.length,
    repeatedPatternCount: patterns,
  };
}

export function makeTempRoot(label = "synthetic out root "): string {
  return mkdtempSync(path.join(os.tmpdir(), label));
}

export function removeTempRoot(root: string): void {
  rmSync(root, { recursive: true, force: true });
}
