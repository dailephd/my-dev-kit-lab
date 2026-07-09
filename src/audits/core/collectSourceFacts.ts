import fs from "node:fs";
import path from "node:path";
import type { FileRole, InventoryFileEntry, NormalizedLanguage, ProjectInventorySnapshot } from "./projectInventory.js";
import { NORMALIZED_LANGUAGES } from "./projectInventory.js";
import {
  DEFAULT_LANGUAGE_ANALYZER_REGISTRY,
  selectLanguageAnalyzer,
  type LanguageAnalyzer,
} from "./languageAnalyzerRegistry.js";
import {
  SOURCE_FACT_PARSE_STATUSES,
  type SourceFactDiagnostic,
  type SourceFactParseStatus,
  type SourceFactsSnapshot,
  type SourceFileFacts,
} from "./sourceFacts.js";

// ---------------------------------------------------------------------------
// v0.3.1 Batch 2 -- source facts collector.
//
// Consumes the Batch 1 ProjectInventorySnapshot (never re-walks the
// filesystem) and produces a SourceFactsSnapshot: analyzer facts where a
// registered analyzer exists, deterministic fallback facts otherwise. Same
// spirit as sourceOfTruth.ts -- pure data collection, never an AuditIssue,
// never a write to a target file.
//
// Eligibility / omission policy (documented here since it's the single
// source of truth for the decision):
//   - Only inventory entries with role "source" or "test" are considered.
//     docs/config/package/generated/vendor/build-output/report-output/
//     unknown-role files are omitted entirely from `files` -- source facts
//     are meaningless for them, and omitting (rather than emitting a
//     "skipped" placeholder for every doc/config file in the repo) keeps
//     the snapshot proportional to actual candidate source files.
//   - For an eligible file in a *known* language (typescript, javascript,
//     python, java, kotlin) with no registered analyzer: parseStatus
//     "file-level-only" -- we know the language and already have
//     inventory-level evidence (lineCount), just no analyzer parsed it yet.
//   - For an eligible file in an *unknown* language: parseStatus
//     "unsupported" -- no file-level evidence attempted either.
//   - File content is only read when a registered analyzer actually claims
//     the file -- with an empty default registry (Batch 2), no file is ever
//     read by this collector.
// ---------------------------------------------------------------------------

const ANALYZABLE_ROLES = new Set<FileRole>(["source", "test"]);
const KNOWN_LANGUAGES = new Set<NormalizedLanguage>(["typescript", "javascript", "python", "java", "kotlin"]);

export async function collectSourceFacts(
  targetRoot: string,
  inventory: ProjectInventorySnapshot,
  registry: readonly LanguageAnalyzer[] = DEFAULT_LANGUAGE_ANALYZER_REGISTRY
): Promise<SourceFactsSnapshot> {
  const resolvedRoot = path.resolve(targetRoot);
  const files: SourceFileFacts[] = [];
  const analyzerDiagnostics: SourceFactDiagnostic[] = [];
  const warnings: string[] = [];

  // inventory.files is already sorted by relativePath (Batch 1 guarantee) --
  // filtering preserves that order, so no re-sort is needed here.
  const eligible = inventory.files.filter((entry) => ANALYZABLE_ROLES.has(entry.role));

  for (const entry of eligible) {
    const analyzer = selectLanguageAnalyzer(registry, entry.language, entry.extension);

    if (!analyzer) {
      files.push(buildFallbackFacts(entry));
      continue;
    }

    const absolutePath = path.join(resolvedRoot, entry.relativePath);
    try {
      const content = fs.readFileSync(absolutePath, "utf8");
      const facts = await analyzer.analyzeFile({
        targetRoot: resolvedRoot,
        relativePath: entry.relativePath,
        absolutePath,
        content,
        inventoryEntry: entry,
        language: entry.language,
        role: entry.role,
      });
      files.push(facts);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const diagnostic: SourceFactDiagnostic = {
        severity: "error",
        code: "analyzer-error",
        message: `Analyzer "${analyzer.id}" failed on "${entry.relativePath}": ${message}`,
        path: entry.relativePath,
        analyzerId: analyzer.id,
      };
      analyzerDiagnostics.push(diagnostic);
      files.push({
        relativePath: entry.relativePath,
        language: entry.language,
        role: entry.role,
        parseStatus: "parse-error",
        analyzerId: analyzer.id,
        lineCount: entry.lineCount,
        imports: [],
        exports: [],
        declarations: [],
        references: [],
        diagnostics: [diagnostic],
      });
    }
  }

  return {
    targetRoot: resolvedRoot,
    files,
    filesByLanguage: countByLanguage(files),
    filesByParseStatus: countByParseStatus(files),
    analyzerDiagnostics,
    warnings,
  };
}

function buildFallbackFacts(entry: InventoryFileEntry): SourceFileFacts {
  const known = KNOWN_LANGUAGES.has(entry.language);
  const parseStatus: SourceFactParseStatus = known ? "file-level-only" : "unsupported";
  const diagnostic: SourceFactDiagnostic = known
    ? {
        severity: "info",
        code: "no-analyzer-registered",
        message: `No language analyzer is registered for "${entry.language}" yet; only inventory-level facts are available.`,
        path: entry.relativePath,
        analyzerId: null,
      }
    : {
        severity: "info",
        code: "unsupported-language",
        message: `Language "${entry.language}" is not supported for source-fact extraction.`,
        path: entry.relativePath,
        analyzerId: null,
      };

  return {
    relativePath: entry.relativePath,
    language: entry.language,
    role: entry.role,
    parseStatus,
    analyzerId: null,
    lineCount: entry.lineCount,
    imports: [],
    exports: [],
    declarations: [],
    references: [],
    diagnostics: [diagnostic],
  };
}

function countByLanguage(files: readonly SourceFileFacts[]): Record<NormalizedLanguage, number> {
  const counts = Object.fromEntries(NORMALIZED_LANGUAGES.map((l) => [l, 0])) as Record<NormalizedLanguage, number>;
  for (const file of files) {
    counts[file.language] += 1;
  }
  return counts;
}

function countByParseStatus(files: readonly SourceFileFacts[]): Record<SourceFactParseStatus, number> {
  const counts = Object.fromEntries(SOURCE_FACT_PARSE_STATUSES.map((s) => [s, 0])) as Record<
    SourceFactParseStatus,
    number
  >;
  for (const file of files) {
    counts[file.parseStatus] += 1;
  }
  return counts;
}
