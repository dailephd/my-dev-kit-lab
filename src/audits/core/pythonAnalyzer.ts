import type { AnalyzeFileInput, LanguageAnalyzer } from "./languageAnalyzerRegistry.js";
import type {
  DeclarationFact,
  ExportFact,
  ImportFact,
  SourceFactDiagnostic,
  SourceFactParseStatus,
  SourceFileFacts,
} from "./sourceFacts.js";

// ---------------------------------------------------------------------------
// v0.3.2 Batch 1 -- conservative, dependency-free Python source analyzer.
//
// There is no Python parser available in this Node/TypeScript project, and
// per this batch's own scope this analyzer must not add a new parser
// dependency. Facts are therefore extracted with a deliberately narrow,
// line-oriented regex scan -- not a real tokenizer, not an AST, and not a
// syntax validator. This is the single-file, best-effort analogue of
// typescriptJavaScriptAnalyzer.ts's AST walk: same LanguageAnalyzer contract,
// same SourceFileFacts shape, same size-bounding philosophy, but confidence
// is necessarily lower since nothing here proves the file is syntactically
// valid Python.
//
// What this DOES extract (see requirements 3 of the batch spec):
//   - import module[, module2][ as alias]
//   - from [.[.]]module import name[ as alias][, ...]  (single physical line)
//   - from module import *
//   - module-level `def`/`async def`/`class` declarations
//   - class-body method declarations, via a simple indentation-based scope
//     stack (not scope-accurate for deeply nested blocks, just "is this def
//     more indented than the nearest enclosing class line")
//   - a single-line `__all__ = [...]`/`(...)` string list, used to set
//     `exported` precisely when present
//
// What this explicitly does NOT do (see requirements 3's "do not implement"
// list): type checking, full AST/semantic resolution, virtualenv/dependency
// resolution, runtime or dynamic import resolution, decorator/metaclass/
// fixture semantics, or any claim of dead-code/duplicate-implementation
// proof. `__import__(...)`/`importlib.import_module(...)` calls are recorded
// only as an informational diagnostic, never as a resolved import fact.
// ---------------------------------------------------------------------------

export const PYTHON_ANALYZER_ID = "python-analyzer";

const SUPPORTED_EXTENSIONS = [".py"] as const;

// Mirrors typescriptJavaScriptAnalyzer.ts's MAX_ANALYZABLE_BYTES bound and
// reasoning -- a large file is not worth line-scanning, and stays at
// file-level-only rather than file-level-only masquerading as parsed.
const MAX_ANALYZABLE_BYTES = 1_000_000;

const IMPORT_LINE_PATTERN = /^\s*import\s+(.+)$/;
const FROM_IMPORT_LINE_PATTERN = /^\s*from\s+(\.{0,2}[\w.]*)\s+import\s+(.+)$/;
const DEF_LINE_PATTERN = /^(\s*)(?:async\s+def|def)\s+([A-Za-z_]\w*)\s*\(/;
const CLASS_LINE_PATTERN = /^(\s*)class\s+([A-Za-z_]\w*)\s*[:(]/;
const ALL_ASSIGNMENT_PATTERN = /^\s*__all__\s*=\s*[[(](.*)$/;
const DYNAMIC_IMPORT_PATTERN = /\b(?:__import__\s*\(|importlib\.import_module\s*\()/;
const QUOTED_NAME_PATTERN = /(['"])((?:(?!\1).)*)\1/g;

export const PYTHON_ANALYZER: LanguageAnalyzer = {
  id: PYTHON_ANALYZER_ID,
  supportedLanguages: ["python"],
  supportedExtensions: SUPPORTED_EXTENSIONS,
  analyzeFile,
};

function analyzeFile(input: AnalyzeFileInput): SourceFileFacts {
  const { relativePath, language, role, content, inventoryEntry } = input;

  if (Buffer.byteLength(content, "utf8") > MAX_ANALYZABLE_BYTES) {
    return {
      relativePath,
      language,
      role,
      parseStatus: "file-level-only",
      analyzerId: PYTHON_ANALYZER_ID,
      lineCount: inventoryEntry.lineCount,
      imports: [],
      exports: [],
      declarations: [],
      references: [],
      diagnostics: [
        {
          severity: "info",
          code: "file-too-large-for-analysis",
          message: `File exceeds the ${MAX_ANALYZABLE_BYTES}-byte analyzer bound; only inventory-level facts are available.`,
          path: relativePath,
          analyzerId: PYTHON_ANALYZER_ID,
        },
      ],
    };
  }

  const diagnostics: SourceFactDiagnostic[] = [];
  const { logical, hadUnterminatedTripleQuote } = buildLogicalLines(content);

  const imports: ImportFact[] = [];
  for (let i = 0; i < logical.length; i++) {
    const line = logical[i];
    const lineNumber = i + 1;
    if (parseFromImportLine(line, lineNumber, imports, diagnostics, relativePath)) continue;
    parseImportLine(line, lineNumber, imports);
  }

  const exportedSet = scanAllExport(logical);
  const declarations = scanDeclarations(logical, exportedSet);
  scanDynamicImportPatterns(logical, diagnostics, relativePath);

  const exports: ExportFact[] = exportedSet ? [...exportedSet].map((name) => ({ name, kind: "named" as const })) : [];

  if (hadUnterminatedTripleQuote) {
    diagnostics.push({
      severity: "error",
      code: "unterminated-triple-quoted-string",
      message:
        "File appears to contain an unterminated triple-quoted string (unbalanced \"\"\"/''' delimiters); facts from this best-effort scan may be incomplete.",
      path: relativePath,
      analyzerId: PYTHON_ANALYZER_ID,
    });
  }

  const parseStatus: SourceFactParseStatus = hadUnterminatedTripleQuote ? "parse-error" : "parsed";

  return {
    relativePath,
    language,
    role,
    parseStatus,
    analyzerId: PYTHON_ANALYZER_ID,
    lineCount: inventoryEntry.lineCount,
    imports,
    exports,
    declarations,
    references: [],
    diagnostics,
  };
}

// ---------------------------------------------------------------------------
// Comment/triple-quoted-string stripping (heuristic, not a tokenizer).
// ---------------------------------------------------------------------------

// Strips a trailing `# comment`, respecting simple single/double-quoted
// strings on the same line (so `x = "a # b"` is not truncated at the `#`
// inside the string). Does not understand triple-quoted strings -- those are
// handled one level up by buildLogicalLines(), which never passes a
// mid-triple-quote-block line to this function.
function stripLineComment(line: string): string {
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === "\\" && (inSingle || inDouble)) {
      i++;
      continue;
    }
    if (ch === "'" && !inDouble) inSingle = !inSingle;
    else if (ch === '"' && !inSingle) inDouble = !inDouble;
    else if (ch === "#" && !inSingle && !inDouble) return line.slice(0, i);
  }
  return line;
}

// Produces one "logical" line per physical line: comments stripped, and any
// content inside a triple-quoted string block (`"""..."""` / `'''...'''`)
// blanked out so it can never be misread as an import/def/class statement.
// Deliberately narrow: only tracks a single open triple-quote marker at a
// time and does not handle more than one triple-quoted segment opening and
// closing on the same physical line.
function buildLogicalLines(content: string): { logical: string[]; hadUnterminatedTripleQuote: boolean } {
  const rawLines = content.split(/\r\n|\r|\n/);
  const logical: string[] = [];
  let openQuote: string | null = null;

  for (const rawLine of rawLines) {
    if (openQuote) {
      const closeIdx = rawLine.indexOf(openQuote);
      if (closeIdx === -1) {
        logical.push("");
        continue;
      }
      openQuote = null;
      logical.push(stripLineComment(rawLine.slice(closeIdx + 3)));
      continue;
    }

    const stripped = stripLineComment(rawLine);
    const tripleMatch = stripped.match(/"""|'''/);
    if (!tripleMatch) {
      logical.push(stripped);
      continue;
    }

    const marker = tripleMatch[0];
    const firstIdx = stripped.indexOf(marker);
    const secondIdx = stripped.indexOf(marker, firstIdx + marker.length);
    if (secondIdx === -1) {
      logical.push(stripped.slice(0, firstIdx));
      openQuote = marker;
    } else {
      logical.push(stripped.slice(0, firstIdx) + stripped.slice(secondIdx + marker.length));
    }
  }

  return { logical, hadUnterminatedTripleQuote: openQuote !== null };
}

function leadingWhitespaceCount(line: string): number {
  let count = 0;
  for (const ch of line) {
    if (ch === " " || ch === "\t") count += 1;
    else break;
  }
  return count;
}

// ---------------------------------------------------------------------------
// Imports.
// ---------------------------------------------------------------------------

function parseImportLine(line: string, lineNumber: number, imports: ImportFact[]): void {
  const match = line.match(IMPORT_LINE_PATTERN);
  if (!match) return;

  for (const rawSegment of match[1].split(",")) {
    const segment = rawSegment.trim();
    if (!segment) continue;
    const asMatch = segment.match(/^([\w.]+)\s+as\s+(\w+)$/);
    if (asMatch) {
      imports.push({ source: asMatch[1], kind: "static", importedNames: [asMatch[2]], line: lineNumber });
    } else {
      imports.push({ source: segment, kind: "static", line: lineNumber });
    }
  }
}

function parseFromImportLine(
  line: string,
  lineNumber: number,
  imports: ImportFact[],
  diagnostics: SourceFactDiagnostic[],
  relativePath: string
): boolean {
  const match = line.match(FROM_IMPORT_LINE_PATTERN);
  if (!match) return false;

  const modulePath = match[1] || ".";
  let namesPart = match[2].trim();

  if (namesPart.startsWith("(") && namesPart.endsWith(")")) {
    namesPart = namesPart.slice(1, -1);
  } else if (namesPart.startsWith("(")) {
    // Multi-line parenthesized from-import list -- this single-line scanner
    // does not follow continuation lines. Recorded as a diagnostic rather
    // than silently dropped or guessed at.
    diagnostics.push({
      severity: "info",
      code: "multiline-from-import-unsupported",
      message: "Multi-line parenthesized from-import list is not analyzed by this conservative single-line scanner.",
      path: relativePath,
      analyzerId: PYTHON_ANALYZER_ID,
    });
    return true;
  }

  if (namesPart === "*") {
    imports.push({ source: modulePath, kind: "static", line: lineNumber });
    return true;
  }

  const importedNames: string[] = [];
  for (const rawSegment of namesPart.split(",")) {
    const segment = rawSegment.trim();
    if (!segment) continue;
    const asMatch = segment.match(/^(\w+)\s+as\s+(\w+)$/);
    importedNames.push(asMatch ? asMatch[2] : segment);
  }

  imports.push({
    source: modulePath,
    kind: "static",
    line: lineNumber,
    ...(importedNames.length > 0 ? { importedNames } : {}),
  });
  return true;
}

// ---------------------------------------------------------------------------
// __all__ (optional, single-line only).
// ---------------------------------------------------------------------------

function scanAllExport(logical: readonly string[]): Set<string> | null {
  for (const line of logical) {
    const match = line.match(ALL_ASSIGNMENT_PATTERN);
    if (!match) continue;
    const names = [...match[1].matchAll(QUOTED_NAME_PATTERN)].map((m) => m[2]);
    if (names.length > 0) return new Set(names);
  }
  return null;
}

function isExported(name: string, exportedSet: Set<string> | null): boolean {
  if (exportedSet) return exportedSet.has(name);
  // Conservative convention-based heuristic when no __all__ is present: a
  // leading underscore is Python's own "not public" signal. This is a
  // heuristic, not a semantic guarantee -- see module header comment.
  return !name.startsWith("_");
}

// ---------------------------------------------------------------------------
// Declarations (functions, async functions, classes, class methods).
// ---------------------------------------------------------------------------

function scanDeclarations(logical: readonly string[], exportedSet: Set<string> | null): DeclarationFact[] {
  const declarations: DeclarationFact[] = [];
  // Indent levels of currently-open `class` blocks, outermost first. A line
  // whose indentation drops to or below the top of this stack has exited
  // that class body.
  const classIndentStack: number[] = [];

  for (let i = 0; i < logical.length; i++) {
    const line = logical[i];
    if (line.trim().length === 0) continue;
    const lineNumber = i + 1;
    const indent = leadingWhitespaceCount(line);

    while (classIndentStack.length > 0 && indent <= classIndentStack[classIndentStack.length - 1]) {
      classIndentStack.pop();
    }

    const classMatch = line.match(CLASS_LINE_PATTERN);
    if (classMatch) {
      const name = classMatch[2];
      declarations.push({ name, kind: "class", exported: isExported(name, exportedSet), line: lineNumber });
      classIndentStack.push(indent);
      continue;
    }

    const defMatch = line.match(DEF_LINE_PATTERN);
    if (defMatch) {
      const name = defMatch[2];
      const isMethod = classIndentStack.length > 0 && indent > classIndentStack[classIndentStack.length - 1];
      declarations.push({
        name,
        kind: isMethod ? "method" : "function",
        // Methods are not tracked against __all__/underscore-export
        // semantics -- __all__ only ever names module-level symbols in
        // real Python, so claiming a method is "exported" would overclaim.
        exported: isMethod ? false : isExported(name, exportedSet),
        line: lineNumber,
      });
    }
  }

  return declarations;
}

function scanDynamicImportPatterns(logical: readonly string[], diagnostics: SourceFactDiagnostic[], relativePath: string): void {
  for (const line of logical) {
    if (!DYNAMIC_IMPORT_PATTERN.test(line)) continue;
    diagnostics.push({
      severity: "info",
      code: "dynamic-import-pattern-unsupported",
      message: "Detected a __import__/importlib.import_module call; dynamic imports are not resolved as import facts.",
      path: relativePath,
      analyzerId: PYTHON_ANALYZER_ID,
    });
  }
}
