import path from "node:path";
import type {
  PlannedRepeatedPattern,
  PlannedSourceModule,
  PlannedSymbol,
  SyntheticRepositoryLanguage,
  SyntheticRepositoryPlanV1,
} from "./types.js";

export type RenderedFileRole = "source" | "test" | "support";

/** One generated file: a logical POSIX path relative to the generated repository root and its canonical text. */
export type RenderedFile = {
  path: string;
  role: RenderedFileRole;
  language?: SyntheticRepositoryLanguage;
  content: string;
};

/** Thrown when a plan cannot be faithfully rendered or a rendered file set disagrees with its plan. */
export class SyntheticRepositoryRenderError extends Error {
  readonly errors: readonly string[];

  constructor(errors: readonly string[]) {
    super(`Synthetic repository rendering failed: ${errors.join("; ")}`);
    this.name = "SyntheticRepositoryRenderError";
    this.errors = [...errors];
  }
}

/** Distinct marker token of one counted repeated pattern occurrence. Appears nowhere else in generated text. */
export const REPEATED_PATTERN_MARKER = "@synthetic-pattern";

const PATTERN_ROLE_LINES: Record<PlannedRepeatedPattern["role"], readonly string[]> = {
  "helper-block": ["Repeated helper block: shared utility shape reused across modules."],
  "table-block": ["Repeated table block: static lookup shape reused across modules."],
  "doc-block": ["Repeated documentation block: explanatory text reused across modules."],
  "guard-block": ["Repeated guard block: input validation shape reused across modules."],
};

/** Canonical text: LF only, no BOM, exactly one trailing newline. Rejects any host line ending or BOM in input lines. */
export function canonicalText(lines: readonly string[]): string {
  for (const line of lines) {
    if (line.includes("\r") || line.includes("\n") || line.includes("﻿")) {
      throw new SyntheticRepositoryRenderError(["rendered line contains a carriage return, newline or byte-order mark."]);
    }
  }
  return `${lines.join("\n")}\n`;
}

export function patternCommentLines(pattern: PlannedRepeatedPattern, comment: string): string[] {
  return [
    `${comment} ${REPEATED_PATTERN_MARKER} ${pattern.patternId} ordinal=${pattern.ordinal} role=${pattern.role}`,
    ...PATTERN_ROLE_LINES[pattern.role].map((line) => `${comment} ${line}`),
    `${comment} @end-synthetic-pattern ${pattern.patternId}`,
  ];
}

export type RenderContext = {
  symbolsByModule: Map<string, PlannedSymbol[]>;
  patternsByModule: Map<string, PlannedRepeatedPattern[]>;
  /** Imported module ids per importing module, in planned (from,to) order. */
  importsByModule: Map<string, string[]>;
  moduleById: Map<string, PlannedSourceModule>;
  symbolById: Map<string, PlannedSymbol>;
};

export function buildRenderContext(plan: SyntheticRepositoryPlanV1): RenderContext {
  const symbolById = new Map(plan.symbols.map((symbol) => [symbol.symbolId, symbol] as const));
  const moduleById = new Map(plan.modules.map((module) => [module.moduleId, module] as const));
  const symbolsByModule = new Map<string, PlannedSymbol[]>();
  for (const module of plan.modules) {
    const own = module.symbolIds.map((symbolId) => symbolById.get(symbolId));
    if (own.length === 0 || own.some((symbol) => symbol === undefined)) {
      throw new SyntheticRepositoryRenderError([`module ${module.moduleId} has no resolvable planned symbol.`]);
    }
    symbolsByModule.set(module.moduleId, own as PlannedSymbol[]);
  }
  const patternsByModule = new Map<string, PlannedRepeatedPattern[]>();
  for (const pattern of plan.repeatedPatterns) {
    if (!moduleById.has(pattern.targetModuleId)) {
      throw new SyntheticRepositoryRenderError([`pattern ${pattern.patternId} targets missing module ${pattern.targetModuleId}.`]);
    }
    const list = patternsByModule.get(pattern.targetModuleId) ?? [];
    list.push(pattern);
    patternsByModule.set(pattern.targetModuleId, list);
  }
  const importsByModule = new Map<string, string[]>();
  for (const edge of plan.importEdges) {
    if (!moduleById.has(edge.from) || !moduleById.has(edge.to)) {
      throw new SyntheticRepositoryRenderError([`import edge ${edge.from} -> ${edge.to} references a missing module.`]);
    }
    const list = importsByModule.get(edge.from) ?? [];
    list.push(edge.to);
    importsByModule.set(edge.from, list);
  }
  return { symbolsByModule, patternsByModule, importsByModule, moduleById, symbolById };
}

/** The symbol other modules import from `moduleId`: its first planned symbol. */
export function exportedSymbolOf(context: RenderContext, moduleId: string): PlannedSymbol {
  return (context.symbolsByModule.get(moduleId) as PlannedSymbol[])[0];
}

/** Rejects planned paths that are not plain relative POSIX logical paths. */
export function assertLogicalPath(logicalPath: string, extension: string): void {
  const segments = logicalPath.split("/");
  if (
    logicalPath.length === 0 ||
    logicalPath.startsWith("/") ||
    logicalPath.includes("\\") ||
    logicalPath.includes(":") ||
    segments.some((segment) => segment === "" || segment === "." || segment === "..") ||
    !logicalPath.endsWith(extension)
  ) {
    throw new SyntheticRepositoryRenderError([`planned path ${JSON.stringify(logicalPath)} cannot be rendered as a safe ${extension} path.`]);
  }
}

/** Relative POSIX specifier from the directory of `fromPath` to `toPath`. */
export function relativeSpecifier(fromPath: string, toPath: string): string {
  const relative = path.posix.relative(path.posix.dirname(fromPath), toPath);
  return relative.startsWith(".") ? relative : `./${relative}`;
}

export function compareLogicalPaths(left: { path: string }, right: { path: string }): number {
  if (left.path < right.path) return -1;
  if (left.path > right.path) return 1;
  return 0;
}
