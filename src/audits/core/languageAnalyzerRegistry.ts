import type { FileRole, InventoryFileEntry, NormalizedLanguage } from "./projectInventory.js";
import type { SourceFileFacts } from "./sourceFacts.js";
import { TYPESCRIPT_JAVASCRIPT_ANALYZER } from "./typescriptJavaScriptAnalyzer.js";

// ---------------------------------------------------------------------------
// v0.3.1 Batch 2 -- language analyzer contract and registry.
//
// v0.3.1 Batch 3 registers the first real analyzer (TypeScript/JavaScript,
// see typescriptJavaScriptAnalyzer.ts) in DEFAULT_LANGUAGE_ANALYZER_REGISTRY
// below, without changing this contract. Mirrors the existing
// auditRegistry.ts pattern (createAuditRegistry/selectDetectors): a plain
// array registry, duplicate-id validation, and a pure selection function.
// Kept synchronous-friendly (analyzeFile may return a Promise) since
// collectSourceFacts.ts already awaits every call -- this costs nothing for
// today's synchronous fallback path but lets a future async analyzer (e.g.
// one that shells out) fit without a contract change.
// ---------------------------------------------------------------------------

export type AnalyzeFileInput = {
  targetRoot: string;
  relativePath: string;
  absolutePath: string;
  content: string;
  inventoryEntry: InventoryFileEntry;
  language: NormalizedLanguage;
  role: FileRole;
};

export type LanguageAnalyzer = {
  id: string;
  supportedLanguages: readonly NormalizedLanguage[];
  // When omitted, every extension for a supported language is eligible.
  supportedExtensions?: readonly string[];
  analyzeFile: (input: AnalyzeFileInput) => SourceFileFacts | Promise<SourceFileFacts>;
};

// Validates a list has no duplicate analyzer ids. Later batches call this
// when assembling their own registries; Batch 2's empty default trivially
// passes.
export function createLanguageAnalyzerRegistry(analyzers: readonly LanguageAnalyzer[]): readonly LanguageAnalyzer[] {
  const seen = new Set<string>();
  for (const analyzer of analyzers) {
    if (seen.has(analyzer.id)) {
      throw new Error(`Duplicate language analyzer id: "${analyzer.id}".`);
    }
    seen.add(analyzer.id);
  }
  return analyzers;
}

// First matching analyzer in registry order (deterministic), or null when
// none supports the given language/extension. Order is preserved from the
// input registry -- not re-sorted.
export function selectLanguageAnalyzer(
  registry: readonly LanguageAnalyzer[],
  language: NormalizedLanguage,
  extension: string
): LanguageAnalyzer | null {
  for (const analyzer of registry) {
    if (!analyzer.supportedLanguages.includes(language)) continue;
    if (analyzer.supportedExtensions && !analyzer.supportedExtensions.includes(extension)) continue;
    return analyzer;
  }
  return null;
}

// v0.3.1 Batch 3 -- registers the TypeScript/JavaScript analyzer. Python,
// Java, and Kotlin remain fallback-only (no analyzer registered for them) --
// see collectSourceFacts.ts's fallback policy.
export const DEFAULT_LANGUAGE_ANALYZER_REGISTRY: readonly LanguageAnalyzer[] = createLanguageAnalyzerRegistry([
  TYPESCRIPT_JAVASCRIPT_ANALYZER,
]);
