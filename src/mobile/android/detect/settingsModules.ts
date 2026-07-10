// ---------------------------------------------------------------------------
// v0.4.0 Batch 2 — bounded, deterministic settings.gradle(.kts) module parser.
//
// Extracts module declarations from common static `include(...)` syntax
// (Groovy and Kotlin DSL) using lexical regex scanning. This intentionally
// does not evaluate Gradle: no variables, functions, conditionals, loops, or
// included builds are resolved. Anything that cannot be statically resolved
// is reported as an unsupported declaration rather than guessed.
// ---------------------------------------------------------------------------

export type ParsedSettingsModules = {
  declaredModulePaths: string[];
  unsupportedDeclarations: string[];
};

// Matches `include` (Groovy bare-args or Kotlin-DSL call) but not
// `includeBuild` (composite builds are out of scope for this batch).
const INCLUDE_CALL_PATTERN = /\binclude\b(?!Build)\s*(\(([\s\S]*?)\)|([^\n;]*))/g;
const QUOTED_STRING_PATTERN = /['"]([^'"]*)['"]/g;
const DYNAMIC_EXPRESSION_PATTERN = /\$\{|\$\w|\bfor\s*\(|\bif\s*\(|\bwhile\s*\(|[+]{1}\s*['"$]/;

function gradlePathToRelativeDir(gradlePath: string): string | null {
  if (!gradlePath.startsWith(":")) {
    return null;
  }
  const segments = gradlePath.split(":").filter((segment) => segment.length > 0);
  if (segments.length === 0) {
    return null;
  }
  return segments.join("/");
}

// Parses declared module paths out of a settings.gradle or settings.gradle.kts
// file's raw text. Supports common Groovy and Kotlin DSL `include(...)` forms
// (single or multiple arguments, single-line or simple multiline calls).
// Dynamic/unresolvable declarations are preserved verbatim (trimmed, bounded)
// in `unsupportedDeclarations` rather than silently dropped.
export function parseDeclaredModules(settingsText: string): ParsedSettingsModules {
  const declaredModulePaths = new Set<string>();
  const unsupportedDeclarations: string[] = [];

  for (const match of settingsText.matchAll(INCLUDE_CALL_PATTERN)) {
    const body = match[2] ?? match[3] ?? "";
    let addedAny = false;
    let dynamicFound = DYNAMIC_EXPRESSION_PATTERN.test(body);

    for (const quoted of body.matchAll(QUOTED_STRING_PATTERN)) {
      const literal = quoted[1];
      // A quoted literal containing an unresolved `$` interpolation is not a
      // static module path, even though it matched the quoted-string regex —
      // it must be reported as unsupported, not silently accepted.
      if (literal.includes("$")) {
        dynamicFound = true;
        continue;
      }
      const relativeDir = gradlePathToRelativeDir(literal);
      if (relativeDir) {
        declaredModulePaths.add(relativeDir);
        addedAny = true;
      }
    }

    if (dynamicFound || (!addedAny && body.trim().length > 0)) {
      unsupportedDeclarations.push(body.trim().slice(0, 200));
    }
  }

  return {
    declaredModulePaths: [...declaredModulePaths].sort((a, b) => a.localeCompare(b)),
    unsupportedDeclarations,
  };
}
