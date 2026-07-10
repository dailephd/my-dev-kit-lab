import type { AnalyzeFileInput, LanguageAnalyzer } from "./languageAnalyzerRegistry.js";
import type {
  DeclarationFact,
  DeclarationFactKind,
  ImportFact,
  SourceFactDiagnostic,
  SourceFactParseStatus,
  SourceFileFacts,
} from "./sourceFacts.js";

// ---------------------------------------------------------------------------
// v0.3.3 Batch 1 -- conservative, dependency-free Java source analyzer.
//
// There is no Java compiler/parser available in this Node/TypeScript
// project, and per this batch's scope this analyzer must not add a new
// parser dependency (no javac, no javaparser-style library). Facts are
// extracted with a deliberately narrow, brace-depth-tracking line scan --
// not a real tokenizer, not an AST, and not a syntax validator. Same
// LanguageAnalyzer contract, same SourceFileFacts shape, and the same
// size-bounding philosophy as typescriptJavaScriptAnalyzer.ts/
// pythonAnalyzer.ts, but confidence is necessarily lower since nothing here
// proves the file is syntactically valid Java.
//
// What this DOES extract:
//   - a single `package foo.bar;` declaration
//   - `import foo.bar.Baz;` and `import static foo.bar.Baz.member;` (both
//     recorded via the existing generic ImportFactKind "static" -- the same
//     "resolved through a static, syntactic import statement" meaning
//     already used by every other analyzer in this project, not a claim
//     about Java's specific "import static" keyword)
//   - top-level and nested class/interface/enum declarations
//   - method and constructor declarations directly inside a class/
//     interface/enum body (both recorded as DeclarationFactKind "method" --
//     there is no dedicated constructor kind in the shared model, and
//     "method" is a safe, non-overclaiming fit)
//   - visibility (public/protected/private/package-private), folded into
//     the existing `exported` boolean: `exported: true` only for an
//     explicit `public` modifier, `false` for protected/private/
//     package-private -- see "Visibility mapping" below for why no new
//     schema field was added
//   - line counts, parse/analyze status, and diagnostics for degraded
//     parsing
//
// What this explicitly does NOT do: real Java compilation, type resolution,
// symbol/overload resolution, inheritance analysis, annotation/framework
// lifecycle understanding, runtime behavior, Gradle/Maven source-set
// validation, semantic duplicate-implementation proof, or dead-code proof.
// Field/property declarations are not extracted (out of this batch's
// required scope, and harder to distinguish conservatively from local
// variable declarations via regex alone). Java text blocks (`"""..."""`,
// Java 15+) are not given special multi-line handling the way Kotlin's raw
// strings are in kotlinAnalyzer.ts -- if present, a `{`/`}`/quote character
// inside one could be slightly miscounted, which is an accepted, narrow
// limitation of a regex/brace-counting scanner rather than a crash risk.
//
// Visibility mapping (no SourceFacts schema change):
//   DeclarationFact has no dedicated visibility field, and per this batch's
//   "prefer no schema change" guidance, none is added here. Java's four
//   visibility levels collapse onto the existing boolean `exported` the
//   same way the Python analyzer already folds its own export heuristic
//   into that field: `public` -> true, everything else (protected/private/
//   package-private) -> false. This intentionally loses the
//   protected-vs-private-vs-package-private distinction; callers that need
//   finer detail must re-derive it from source, which this analyzer does
//   not claim to make unnecessary.
// ---------------------------------------------------------------------------

export const JAVA_ANALYZER_ID = "java-analyzer";

const SUPPORTED_EXTENSIONS = [".java"] as const;

// Mirrors typescriptJavaScriptAnalyzer.ts/pythonAnalyzer.ts's bound.
const MAX_ANALYZABLE_BYTES = 1_000_000;

const PACKAGE_LINE_PATTERN = /^\s*package\s+([\w.]+)\s*;/;
const IMPORT_LINE_PATTERN = /^\s*import\s+(static\s+)?([\w.]+(?:\.\*)?)\s*;/;

// Requires an explicit visibility modifier to be captured separately so
// "no modifier present" (package-private) is distinguishable from an
// explicit one -- see MODIFIER_PATTERN below.
const MODIFIER_WORDS =
  "(?:public|protected|private|static|final|abstract|sealed|non-sealed|strictfp|synchronized|native|default)";
const TYPE_DECL_PATTERN = new RegExp(
  `^\\s*(?:${MODIFIER_WORDS}\\s+)*(class|interface|enum|record)\\s+(\\w+)`
);
// Two separate word-tokens (a return-type-like token, then the method name)
// before the parameter list -- this is what keeps `if (...)`, `for (...)`,
// `while (...)`, `switch (...)`, and plain method-call statements
// (`foo.bar(x);`, a single dotted token with no preceding space) from ever
// matching: those all have only one space-separated token before `(`.
// The trailing group accepts either just an opening brace (multi-line
// body), a semicolon (abstract/interface method declaration), or a full
// one-liner body with no nested braces (e.g. `{ return true; }`, `{}`) --
// without the last alternative, a common one-liner accessor/getter would
// never be recognized as a declaration at all.
const METHOD_LINE_PATTERN = new RegExp(
  `^\\s*(?:${MODIFIER_WORDS}\\s+)*[\\w<>\\[\\],.?]+\\s+(\\w+)\\s*\\(([^()]*)\\)\\s*(?:throws\\s+[\\w.,\\s<>]+)?\\s*(?:\\{[^{}]*\\}|\\{|;)\\s*$`
);
// A constructor has no return-type token: just an optional visibility
// modifier, the identifier, then the parameter list. The caller only
// accepts a match here when the identifier equals the enclosing class/
// enum/record name, which is what actually distinguishes a real
// constructor from a stray call-like statement (see analyzeFile below).
const CONSTRUCTOR_LINE_PATTERN =
  /^\s*(?:(?:public|protected|private)\s+)?(\w+)\s*\(([^()]*)\)\s*(?:throws\s+[\w.,\s<>]+)?\s*(?:\{[^{}]*\}|\{)\s*$/;
const EXPLICIT_MODIFIER_PATTERN = /(?:^|\s)(public|protected|private)(?:\s|$)/;

// "record" is a valid TYPE_DECL_PATTERN match but is always normalized to
// "class" before it reaches a ScopeFrame/DeclarationFact -- see the
// normalizedKind comment in analyzeFile below.
type ScopeKind = "class" | "interface" | "enum";
type ScopeFrame = {
  kind: ScopeKind;
  name: string;
  // Brace depth of statements directly inside this scope's own body (i.e.
  // the depth reached immediately after its opening `{`, whenever that
  // brace actually appears -- see analyzeFile's scope-push comment).
  bodyDepth: number;
};

export const JAVA_ANALYZER: LanguageAnalyzer = {
  id: JAVA_ANALYZER_ID,
  supportedLanguages: ["java"],
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
      analyzerId: JAVA_ANALYZER_ID,
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
          analyzerId: JAVA_ANALYZER_ID,
        },
      ],
    };
  }

  const diagnostics: SourceFactDiagnostic[] = [];
  const { logical, hadUnterminatedBlockComment } = buildLogicalLines(content);

  const imports: ImportFact[] = [];
  const declarations: DeclarationFact[] = [];
  const scopeStack: ScopeFrame[] = [];
  let depth = 0;
  let packageSeen = false;

  for (let i = 0; i < logical.length; i++) {
    const line = logical[i];
    const lineNumber = i + 1;
    if (line.trim().length === 0) {
      continue;
    }

    if (!packageSeen) {
      const packageMatch = line.match(PACKAGE_LINE_PATTERN);
      if (packageMatch) packageSeen = true;
    }

    const importMatch = line.match(IMPORT_LINE_PATTERN);
    if (importMatch) {
      imports.push({ source: importMatch[2], kind: "static", line: lineNumber });
    }

    const typeMatch = line.match(TYPE_DECL_PATTERN);
    // "record" (a restricted, implicitly-final class variant) is folded
    // into the existing "class" DeclarationFactKind/ScopeKind -- there is
    // no dedicated record kind in the shared model, and "class" is a safe,
    // non-overclaiming fit (a record's synthesized accessor/constructor
    // methods are not separately modeled).
    const normalizedKind: ScopeKind | null = typeMatch ? (typeMatch[1] === "record" ? "class" : (typeMatch[1] as ScopeKind)) : null;
    if (typeMatch && normalizedKind) {
      const name = typeMatch[2];
      declarations.push({
        name,
        kind: normalizedKind,
        exported: EXPLICIT_MODIFIER_PATTERN.exec(line.slice(0, typeMatch.index! + typeMatch[0].length))?.[1] === "public",
        line: lineNumber,
      });
    } else if (scopeStack.length > 0 && depth === scopeStack[scopeStack.length - 1].bodyDepth) {
      const currentScope = scopeStack[scopeStack.length - 1];
      const methodMatch = line.match(METHOD_LINE_PATTERN);
      if (methodMatch) {
        pushMethodDeclaration(declarations, methodMatch[1], line, lineNumber);
      } else {
        const ctorMatch = line.match(CONSTRUCTOR_LINE_PATTERN);
        if (ctorMatch && ctorMatch[1] === currentScope.name) {
          pushMethodDeclaration(declarations, ctorMatch[1], line, lineNumber);
        }
      }
    }

    const depthBefore = depth;
    depth += countChar(line, "{") - countChar(line, "}");

    if (typeMatch && normalizedKind) {
      // Always push assuming depth+1 is the body -- whether the opening
      // brace was on this same line (K&R style, the common case) or a
      // subsequent line (Allman style), the actual `{` character
      // eventually seen will bump `depth` to exactly `depthBefore + 1`,
      // matching this assumption either way.
      scopeStack.push({ kind: normalizedKind, name: typeMatch[2], bodyDepth: depthBefore + 1 });
    }

    while (scopeStack.length > 0 && depth < scopeStack[scopeStack.length - 1].bodyDepth) {
      scopeStack.pop();
    }
  }

  if (hadUnterminatedBlockComment) {
    diagnostics.push({
      severity: "error",
      code: "unterminated-block-comment",
      message: "File appears to contain an unterminated /* block comment; facts from this best-effort scan may be incomplete.",
      path: relativePath,
      analyzerId: JAVA_ANALYZER_ID,
    });
  }

  const parseStatus: SourceFactParseStatus = hadUnterminatedBlockComment ? "parse-error" : "parsed";

  return {
    relativePath,
    language,
    role,
    parseStatus,
    analyzerId: JAVA_ANALYZER_ID,
    lineCount: inventoryEntry.lineCount,
    imports,
    exports: [],
    declarations,
    references: [],
    diagnostics,
  };
}

function pushMethodDeclaration(declarations: DeclarationFact[], name: string, line: string, lineNumber: number): void {
  const kind: DeclarationFactKind = "method";
  declarations.push({
    name,
    kind,
    exported: EXPLICIT_MODIFIER_PATTERN.exec(line)?.[1] === "public",
    line: lineNumber,
  });
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
// comments and `/* ... */` block comments (which may span multiple
// lines), and blanks out the contents of `"..."` and `'...'` literals
// (escape-aware) so a brace/quote character inside a string or comment can
// never be misread as real code structure. Does not give Java 15+ text
// blocks (`"""..."""`) special multi-line handling -- see this file's
// header comment.
// ---------------------------------------------------------------------------

function buildLogicalLines(content: string): { logical: string[]; hadUnterminatedBlockComment: boolean } {
  const rawLines = content.split(/\r\n|\r|\n/);
  const logical: string[] = [];
  let inBlockComment = false;

  for (const rawLine of rawLines) {
    logical.push(stripLine(rawLine));
  }

  return { logical, hadUnterminatedBlockComment: inBlockComment };

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
