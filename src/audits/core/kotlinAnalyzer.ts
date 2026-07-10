import type { AnalyzeFileInput, LanguageAnalyzer } from "./languageAnalyzerRegistry.js";
import type {
  DeclarationFact,
  ImportFact,
  SourceFactDiagnostic,
  SourceFactParseStatus,
  SourceFileFacts,
} from "./sourceFacts.js";

// ---------------------------------------------------------------------------
// v0.3.3 Batch 1 -- conservative, dependency-free Kotlin source analyzer.
//
// There is no Kotlin compiler/parser available in this Node/TypeScript
// project, and per this batch's scope this analyzer must not add a new
// parser dependency. Facts are extracted with the same style of
// brace-depth-tracking line scan as javaAnalyzer.ts -- not a real
// tokenizer, not an AST, and not a syntax validator.
//
// What this DOES extract:
//   - a single `package foo.bar` declaration (no trailing `;` required)
//   - `import foo.bar.Baz` and `import foo.bar.Baz as Alias` (recorded via
//     the existing generic ImportFactKind "static" -- "resolved through a
//     static, syntactic import statement", the same meaning already used
//     by every other analyzer in this project)
//   - class, data class, interface, and object declarations (data class ->
//     DeclarationFactKind "class"; object -> "class", the closest safe
//     existing kind for a singleton declaration -- there is no dedicated
//     object kind in the shared model)
//   - `enum class Foo` -> DeclarationFactKind "enum"
//   - top-level function declarations (`fun foo(...)`) -> kind "function"
//   - member function declarations directly inside a class/interface/
//     object body -> kind "method"
//   - visibility (public/internal/protected/private), folded into the
//     existing `exported` boolean -- see "Visibility mapping" below
//   - line counts, parse/analyze status, and diagnostics for degraded
//     parsing
//
// What this explicitly does NOT do: real Kotlin compilation, type
// inference, extension-function semantic resolution (an extension
// function's receiver type is not modeled -- only the function's own
// identifier is recorded as its name), coroutine behavior, multiplatform
// source-set semantics, Android/Compose lifecycle behavior, runtime
// behavior, semantic duplicate-implementation proof, or dead-code proof.
// Property (`val`/`var`) declarations are not extracted (out of this
// batch's required scope, and harder to distinguish conservatively from
// local variable declarations via regex alone).
//
// Visibility mapping (no SourceFacts schema change):
//   Same reasoning as javaAnalyzer.ts. Kotlin's default (no modifier) is
//   `public`, unlike Java's package-private default -- so `exported` is
//   true unless an explicit `internal`, `protected`, or `private` modifier
//   is present. This intentionally collapses internal/protected/private
//   into a single "not exported" bucket; callers needing that distinction
//   must re-derive it from source.
// ---------------------------------------------------------------------------

export const KOTLIN_ANALYZER_ID = "kotlin-analyzer";

const SUPPORTED_EXTENSIONS = [".kt", ".kts"] as const;

// Mirrors typescriptJavaScriptAnalyzer.ts/pythonAnalyzer.ts/javaAnalyzer.ts's
// bound.
const MAX_ANALYZABLE_BYTES = 1_000_000;

const PACKAGE_LINE_PATTERN = /^\s*package\s+([\w.]+)\s*;?\s*$/;
const IMPORT_LINE_PATTERN = /^\s*import\s+([\w.]+(?:\.\*)?)(?:\s+as\s+(\w+))?\s*;?\s*$/;

const VISIBILITY_WORDS = "(?:public|internal|protected|private)";
const OTHER_TYPE_MODIFIER_WORDS =
  "(?:open|final|abstract|sealed|inner|data|annotation|enum|companion|value|actual|expect)";
const TYPE_DECL_PATTERN = new RegExp(
  `^\\s*(${VISIBILITY_WORDS}\\s+)?((?:${OTHER_TYPE_MODIFIER_WORDS}\\s+)*)(class|interface|object)\\s+(\\w+)`
);
// Optional generic receiver/type parameters and an optional extension-
// function receiver (`ReceiverType.`) before the function name -- the
// receiver itself is discarded, only the final identifier is kept as the
// function's name (see header comment).
const FUN_LINE_PATTERN = new RegExp(
  `^\\s*(${VISIBILITY_WORDS}\\s+)?(?:(?:override|open|final|abstract|inline|suspend|operator|infix|tailrec|external)\\s+)*fun(?:\\s*<[^>]*>)?\\s+(?:[\\w<>?.]+\\.)?(\\w+)\\s*\\(`
);

type ScopeKind = "class" | "interface";
type ScopeFrame = {
  kind: ScopeKind;
  bodyDepth: number;
};

export const KOTLIN_ANALYZER: LanguageAnalyzer = {
  id: KOTLIN_ANALYZER_ID,
  supportedLanguages: ["kotlin"],
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
      analyzerId: KOTLIN_ANALYZER_ID,
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
          analyzerId: KOTLIN_ANALYZER_ID,
        },
      ],
    };
  }

  const diagnostics: SourceFactDiagnostic[] = [];
  const { logical, hadUnterminatedBlockComment, hadUnterminatedRawString } = buildLogicalLines(content);

  const imports: ImportFact[] = [];
  const declarations: DeclarationFact[] = [];
  const scopeStack: ScopeFrame[] = [];
  let depth = 0;

  for (let i = 0; i < logical.length; i++) {
    const line = logical[i];
    const lineNumber = i + 1;
    if (line.trim().length === 0) {
      continue;
    }

    const importMatch = line.match(IMPORT_LINE_PATTERN);
    if (importMatch) {
      imports.push({
        source: importMatch[1],
        kind: "static",
        line: lineNumber,
        ...(importMatch[2] ? { importedNames: [importMatch[2]] } : {}),
      });
    }

    const typeMatch = line.match(TYPE_DECL_PATTERN);
    let isEnumClass = false;
    if (typeMatch) {
      isEnumClass = /(?:^|\s)enum(?:\s|$)/.test(typeMatch[2]);
    }

    if (typeMatch) {
      const rawKeyword = typeMatch[3]; // "class" | "interface" | "object"
      const name = typeMatch[4];
      const exported = typeMatch[1] === undefined || typeMatch[1].trim() === "public";
      declarations.push({
        name,
        kind: isEnumClass ? "enum" : rawKeyword === "interface" ? "interface" : "class",
        exported,
        line: lineNumber,
      });
    } else if (scopeStack.length > 0 && depth === scopeStack[scopeStack.length - 1].bodyDepth) {
      const funMatch = line.match(FUN_LINE_PATTERN);
      if (funMatch) {
        const exported = funMatch[1] === undefined || funMatch[1].trim() === "public";
        declarations.push({ name: funMatch[2], kind: "method", exported, line: lineNumber });
      }
    } else if (scopeStack.length === 0) {
      const funMatch = line.match(FUN_LINE_PATTERN);
      if (funMatch) {
        const exported = funMatch[1] === undefined || funMatch[1].trim() === "public";
        declarations.push({ name: funMatch[2], kind: "function", exported, line: lineNumber });
      }
    }

    const depthBefore = depth;
    depth += countChar(line, "{") - countChar(line, "}");

    if (typeMatch) {
      const rawKeyword = typeMatch[3];
      // class/object and interface both get a scope frame ("object" is
      // tracked as a "class"-kind scope for member-function purposes);
      // whether the opening `{` lands on this line or a later one, the
      // eventual `{` bumps depth to exactly depthBefore + 1 either way --
      // same reasoning as javaAnalyzer.ts's scope push.
      const scopeKind: ScopeKind = rawKeyword === "interface" ? "interface" : "class";
      scopeStack.push({ kind: scopeKind, bodyDepth: depthBefore + 1 });
    }

    while (scopeStack.length > 0 && depth < scopeStack[scopeStack.length - 1].bodyDepth) {
      scopeStack.pop();
    }
  }

  if (hadUnterminatedRawString) {
    diagnostics.push({
      severity: "error",
      code: "unterminated-raw-string",
      message: 'File appears to contain an unterminated """ raw string; facts from this best-effort scan may be incomplete.',
      path: relativePath,
      analyzerId: KOTLIN_ANALYZER_ID,
    });
  }
  if (hadUnterminatedBlockComment) {
    diagnostics.push({
      severity: "error",
      code: "unterminated-block-comment",
      message: "File appears to contain an unterminated /* block comment; facts from this best-effort scan may be incomplete.",
      path: relativePath,
      analyzerId: KOTLIN_ANALYZER_ID,
    });
  }

  const parseStatus: SourceFactParseStatus =
    hadUnterminatedRawString || hadUnterminatedBlockComment ? "parse-error" : "parsed";

  return {
    relativePath,
    language,
    role,
    parseStatus,
    analyzerId: KOTLIN_ANALYZER_ID,
    lineCount: inventoryEntry.lineCount,
    imports,
    exports: [],
    declarations,
    references: [],
    diagnostics,
  };
}

function countChar(line: string, ch: string): number {
  let count = 0;
  for (let i = 0; i < line.length; i++) {
    if (line[i] === ch) count += 1;
  }
  return count;
}

// ---------------------------------------------------------------------------
// Comment/string stripping (heuristic, not a tokenizer). Strips `//` line
// comments and `/* ... */` block comments (which may span multiple lines),
// blanks out `"..."`/`'...'` single-line literal contents (escape-aware),
// and blanks out `"""..."""` raw strings (which may span multiple lines,
// no escape processing inside -- mirrors pythonAnalyzer.ts's triple-quote
// handling, since Kotlin raw strings share the same "arbitrary content
// until the next matching triple-quote marker" shape).
// ---------------------------------------------------------------------------

function buildLogicalLines(content: string): {
  logical: string[];
  hadUnterminatedBlockComment: boolean;
  hadUnterminatedRawString: boolean;
} {
  const rawLines = content.split(/\r\n|\r|\n/);
  const logical: string[] = [];
  let inBlockComment = false;
  let inRawString = false;

  for (const rawLine of rawLines) {
    if (inRawString) {
      const closeIdx = rawLine.indexOf('"""');
      if (closeIdx === -1) {
        logical.push("");
        continue;
      }
      inRawString = false;
      logical.push(stripLine(rawLine.slice(closeIdx + 3)));
      continue;
    }
    logical.push(stripLine(rawLine));
  }

  return { logical, hadUnterminatedBlockComment: inBlockComment, hadUnterminatedRawString: inRawString };

  function stripLine(line: string): string {
    let result = "";
    let i = 0;
    while (i < line.length) {
      if (inBlockComment) {
        const closeIdx = line.indexOf("*/", i);
        if (closeIdx === -1) return result;
        inBlockComment = false;
        i = closeIdx + 2;
        continue;
      }
      const ch = line[i];
      if (ch === "/" && line[i + 1] === "/") return result;
      if (ch === "/" && line[i + 1] === "*") {
        inBlockComment = true;
        i += 2;
        continue;
      }
      if (line.slice(i, i + 3) === '"""') {
        const closeIdx = line.indexOf('"""', i + 3);
        if (closeIdx === -1) {
          inRawString = true;
          return result;
        }
        i = closeIdx + 3;
        continue;
      }
      if (ch === '"' || ch === "'") {
        const quote = ch;
        let j = i + 1;
        while (j < line.length) {
          if (line[j] === "\\") {
            j += 2;
            continue;
          }
          if (line[j] === quote) {
            j += 1;
            break;
          }
          j += 1;
        }
        i = j;
        continue;
      }
      result += ch;
      i += 1;
    }
    return result;
  }
}
