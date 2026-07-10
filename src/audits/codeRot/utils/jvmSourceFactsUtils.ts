import type { ImportFact } from "../../core/sourceFacts.js";

// ---------------------------------------------------------------------------
// v0.3.3 Batch 2 -- shared JVM (Java/Kotlin) source-facts helpers reused by
// deadCodeCandidateDetector.ts, duplicateImplementationDetector.ts, and
// testRotDetector.ts.
//
// Deterministic and dependency-free: no Gradle/Maven execution, no
// classpath resolution, no Java/Kotlin compiler, no traversal outside the
// target root. Everything here operates purely on already-collected
// SourceFacts/inventory data (see javaAnalyzer.ts/kotlinAnalyzer.ts/
// jvmProjectMetadata.ts from v0.3.3 Batch 1).
// ---------------------------------------------------------------------------

// Import prefixes considered standard-library or common third-party test
// framework noise -- never treated as "possibly a local project import" by
// testRotDetector.ts's JVM resolver, regardless of whether a local file
// happens to share a path segment. Matched against the import source's
// leading dotted segments so "java.util.List" matches "java." but a
// hypothetical local package literally named "javautils.Foo" (no dot after
// "java") would not.
const JVM_SKIPPABLE_IMPORT_PREFIXES = [
  "java.",
  "javax.",
  "jakarta.",
  "kotlin.",
  "kotlinx.",
  "org.junit.",
  "org.assertj.",
  "org.mockito.",
  "org.hamcrest.",
  "io.kotest.",
] as const;

export function isJvmSkippableImportSource(source: string): boolean {
  return JVM_SKIPPABLE_IMPORT_PREFIXES.some((prefix) => source.startsWith(prefix));
}

// True for a wildcard-style import (`import com.example.*` or, for Java
// static imports, `import static com.example.Foo.*`). Deliberately treated
// as never "safely local" by testRotDetector.ts's JVM resolver -- there is
// no way to derive a single candidate file from a wildcard without real
// classpath/package-member awareness, so guessing would either miss real
// stale imports (if resolved unconditionally) or produce high-noise false
// positives (if flagged unconditionally). Skipping entirely is the
// conservative choice.
export function isJvmWildcardImportSource(source: string): boolean {
  return source.endsWith(".*");
}

// The simple (unqualified) name a dotted JVM import source resolves to --
// the last segment after the final ".". For a Java static import
// (`static com.example.Foo.bar`), this is the imported static member name,
// not the enclosing class -- an accepted, documented conflation for this
// conservative, best-effort scan (see javaAnalyzer.ts's own header comment
// on why `import static` is not modeled any more precisely than a plain
// import).
export function jvmImportSimpleName(source: string): string {
  const idx = source.lastIndexOf(".");
  return idx === -1 ? source : source.slice(idx + 1);
}

// Converts a dotted JVM import source (e.g. "com.example.Foo") into a
// package-shaped relative path segment (e.g. "com/example/Foo"), dropping
// any trailing wildcard/member segment handling -- callers are responsible
// for skipping wildcards via isJvmWildcardImportSource() first.
export function jvmImportToPackagePath(source: string): string {
  return source.split(".").join("/");
}

// Candidate on-disk relative paths for a (non-wildcard, non-skippable)
// import, given the project's recognized Java/Kotlin source-set
// directories (see jvmProjectMetadata.ts's recognizedSourceDirectories).
// Conservative and path-based only: this never resolves the real classpath,
// only checks the conventional Gradle/Maven `src/main/{java,kotlin}/...`
// layout. `extensions` lets a Kotlin importer also check `.java` (Kotlin
// can legitimately import Java source in a mixed JVM project) while a Java
// importer only ever checks `.java`.
export function jvmImportCandidatePaths(
  source: string,
  recognizedSourceDirectories: readonly string[],
  extensions: readonly string[]
): string[] {
  const packagePath = jvmImportToPackagePath(source);
  const candidates: string[] = [];
  for (const dir of recognizedSourceDirectories) {
    for (const ext of extensions) {
      candidates.push(`${dir}/${packagePath}.${ext}`);
    }
  }
  return candidates;
}

// True when an ImportFact looks worth checking for local-file existence at
// all -- i.e. not a standard-library/common-test-framework import and not a
// wildcard. Callers still need their own existence check; this only
// filters out imports this conservative scan should never second-guess.
export function jvmImportLooksPossiblyLocal(imp: ImportFact): boolean {
  if (isJvmWildcardImportSource(imp.source)) return false;
  if (isJvmSkippableImportSource(imp.source)) return false;
  // A bare, undotted import (e.g. a same-package reference, or a malformed
  // scan artifact) has no package path to resolve against -- not
  // checkable by this path-based resolver.
  if (!imp.source.includes(".")) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Declaration-name conservatism helpers.
// ---------------------------------------------------------------------------

// Common JVM class/type names that legitimately repeat across unrelated
// projects/modules (a "Main" class, an "App" entrypoint, a "Config" class
// per module, etc.) -- excluded from duplicateImplementationDetector.ts's
// JVM duplicate-declaration-candidate check the same way
// GENERIC_DECLARATION_NAMES/GENERIC_INFRA_BASENAMES already exclude their
// TS/JS/Python/file-basename equivalents.
const JVM_COMMON_TYPE_NAMES = new Set([
  "main",
  "app",
  "application",
  "config",
  "configuration",
  "utils",
  "helper",
  "factory",
  "builder",
  "manager",
  "service",
  "controller",
  "repository",
]);

export function isJvmCommonLowSignalDeclarationName(name: string): boolean {
  const lower = name.toLowerCase();
  if (JVM_COMMON_TYPE_NAMES.has(lower)) return true;
  if (lower.startsWith("test")) return true;
  return lower === "setup" || lower === "teardown";
}

// Java/Kotlin lifecycle, `Object`-override, and bean-accessor-shaped names
// -- excluded from deadCodeCandidateDetector.ts's JVM dead-code-candidate
// check, the same way isGenericOrTestPrefixedDeclarationName() already
// excludes TS/JS/Python's equivalents. `get*`/`set*`/`is*` in particular
// cover the extremely common JavaBean accessor convention, where a
// "no detected cross-file reference" signal is essentially meaningless
// (framework/reflection-based access is invisible to this static scan).
const JVM_LIFECYCLE_EXACT_NAMES = new Set([
  "main",
  "tostring",
  "equals",
  "hashcode",
  "compareto",
  "clone",
  "setup",
  "teardown",
  "copy", // Kotlin data class synthesized-like member
]);
const JVM_LIFECYCLE_PREFIXES = ["get", "set", "is", "can", "should", "before", "after", "test", "component"];

export function isJvmLifecycleOrConventionalDeclarationName(name: string): boolean {
  const lower = name.toLowerCase();
  if (JVM_LIFECYCLE_EXACT_NAMES.has(lower)) return true;
  return JVM_LIFECYCLE_PREFIXES.some((prefix) => lower.startsWith(prefix));
}
