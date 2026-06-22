import type { SecurityCheckCategory, SecuritySeverity } from "./types.js";

// Test matrix for the my-dev-kit security-validation framework.
// Each entry documents a planned or implemented adversarial test case.
// Implementation status starts as "planned" and moves to "implemented" when the
// corresponding test file is created in tests/security/ or tests/fuzz/.

export type TestMatrixImplementationStatus = "planned" | "implemented" | "skipped-environment";

export type TestMatrixEntry = {
  id: string;
  title: string;
  category: SecurityCheckCategory;
  attackSurface: string;
  inputExamples: string[];
  expectedBehavior: string;
  severityIfFailed: SecuritySeverity;
  implementationStatus: TestMatrixImplementationStatus;
};

export const SECURITY_TEST_MATRIX: TestMatrixEntry[] = [
  // ---------------------------------------------------------------------------
  // Path and filesystem tests
  // ---------------------------------------------------------------------------
  {
    id: "path-traversal-root",
    title: "Path traversal via --root",
    category: "cli-adversarial",
    attackSurface: "--root",
    inputExamples: ["--root ../../etc", "--root /etc/passwd", "--root ..\\..\\Windows"],
    expectedBehavior: "CLI rejects the path or confines all operations within an allowed boundary; no file access outside the intended repo root",
    severityIfFailed: "blocker",
    implementationStatus: "implemented",
  },
  {
    id: "path-traversal-out",
    title: "Path traversal via --out",
    category: "cli-adversarial",
    attackSurface: "--out",
    inputExamples: ["--out ../../etc/cron.d", "--out /tmp/escape"],
    expectedBehavior: "Output is written only within the specified directory; no writes outside the intended output tree",
    severityIfFailed: "blocker",
    implementationStatus: "implemented",
  },
  {
    id: "path-traversal-index",
    title: "Path traversal via --index",
    category: "cli-adversarial",
    attackSurface: "--index",
    inputExamples: ["--index ../../etc/.my-dev-kit"],
    expectedBehavior: "Index path is validated; reads are confined to the specified index directory",
    severityIfFailed: "blocker",
    implementationStatus: "implemented",
  },
  {
    id: "absolute-path-escape",
    title: "Absolute path outside repo root",
    category: "cli-adversarial",
    attackSurface: "--root, --src, --file",
    inputExamples: ["--file /etc/hosts", "--src C:\\Windows\\System32"],
    expectedBehavior: "CLI rejects absolute paths that escape the declared root boundary",
    severityIfFailed: "blocker",
    implementationStatus: "implemented",
  },
  {
    id: "symlink-junction-escape",
    title: "Symlink or junction escape",
    category: "cli-adversarial",
    attackSurface: "--root, --src",
    inputExamples: ["directory containing a symlink pointing outside the root"],
    expectedBehavior: "Symlink targets outside the root are not followed or are treated as out-of-scope",
    severityIfFailed: "major",
    implementationStatus: "skipped-environment",
  },
  {
    id: "generated-cleanup-user-files",
    title: "Generated artifact cleanup must not delete user files",
    category: "artifact-safety",
    attackSurface: "artifact refresh / re-index cleanup",
    inputExamples: ["index refresh over a directory that contains user source files"],
    expectedBehavior: "Only generated artifacts in the explicitly declared output path are removed; user source files are never deleted",
    severityIfFailed: "blocker",
    implementationStatus: "implemented",
  },

  // ---------------------------------------------------------------------------
  // Read-only boundary tests
  // ---------------------------------------------------------------------------
  {
    id: "source-files-not-modified",
    title: "Source files are not modified during indexing",
    category: "cli-adversarial",
    attackSurface: "index command on a real source tree",
    inputExamples: ["npm run index -- --root benchmarks/projects/todo-ts"],
    expectedBehavior: "All source files in the root directory have the same content and modification time after indexing completes",
    severityIfFailed: "blocker",
    implementationStatus: "implemented",
  },
  {
    id: "writes-limited-to-output",
    title: "Writes are limited to declared artifact paths",
    category: "cli-adversarial",
    attackSurface: "--out, --index",
    inputExamples: ["run index with --out pointing to a temp directory; verify no writes elsewhere"],
    expectedBehavior: "No files are created or modified outside the declared output and index paths",
    severityIfFailed: "blocker",
    implementationStatus: "implemented",
  },

  // ---------------------------------------------------------------------------
  // Malformed artifact tests
  // ---------------------------------------------------------------------------
  {
    id: "malformed-manifest-json",
    title: "Malformed manifest.json is rejected safely",
    category: "artifact-safety",
    attackSurface: "manifest reader",
    inputExamples: ["{", "null", "[]", "{\"version\": null}", "not JSON at all"],
    expectedBehavior: "CLI surfaces a clear error without crashing or panicking; no partial state is committed",
    severityIfFailed: "major",
    implementationStatus: "implemented",
  },
  {
    id: "malformed-symbol-index-json",
    title: "Malformed symbol-index.json is rejected safely",
    category: "artifact-safety",
    attackSurface: "symbol-index reader",
    inputExamples: ["truncated JSON", "array instead of object", "missing required fields"],
    expectedBehavior: "Clear error message; no crash",
    severityIfFailed: "major",
    implementationStatus: "planned",
  },
  {
    id: "malformed-code-graph-json",
    title: "Malformed code-graph.json is rejected safely",
    category: "artifact-safety",
    attackSurface: "code-graph reader",
    inputExamples: ["empty object", "nodes array is null", "cyclic reference marker"],
    expectedBehavior: "Clear error message; no crash",
    severityIfFailed: "major",
    implementationStatus: "implemented",
  },
  {
    id: "malformed-data-model-json",
    title: "Malformed data-model.json is rejected safely",
    category: "artifact-safety",
    attackSurface: "data-model reader",
    inputExamples: ["truncated JSON", "missing schema version"],
    expectedBehavior: "Clear error message; no crash",
    severityIfFailed: "major",
    implementationStatus: "planned",
  },
  {
    id: "malformed-frontend-semantic-json",
    title: "Malformed frontend-semantic.json is rejected safely",
    category: "artifact-safety",
    attackSurface: "frontend-semantic reader",
    inputExamples: ["empty file", "non-JSON content", "schema version mismatch"],
    expectedBehavior: "Clear error message; no crash",
    severityIfFailed: "major",
    implementationStatus: "planned",
  },
  {
    id: "unsupported-schema-version",
    title: "Unsupported schema version produces a clear error",
    category: "artifact-safety",
    attackSurface: "all artifact readers",
    inputExamples: ["{\"schemaVersion\": 9999}", "{\"schemaVersion\": \"future\"}"],
    expectedBehavior: "CLI reports an unsupported-version error with the version it found; no silent data corruption",
    severityIfFailed: "major",
    implementationStatus: "implemented",
  },
  {
    id: "missing-index-directory",
    title: "Missing index directory produces a clear error",
    category: "artifact-safety",
    attackSurface: "--index pointing to a nonexistent path",
    inputExamples: ["--index /nonexistent/.my-dev-kit"],
    expectedBehavior: "Clear error stating the index directory does not exist; no crash",
    severityIfFailed: "minor",
    implementationStatus: "implemented",
  },

  // ---------------------------------------------------------------------------
  // JSON stdout/stderr tests
  // ---------------------------------------------------------------------------
  {
    id: "json-mode-parseable-output",
    title: "JSON mode returns parseable JSON",
    category: "cli-adversarial",
    attackSurface: "--format json or equivalent JSON output mode",
    inputExamples: ["any valid CLI command with JSON output enabled"],
    expectedBehavior: "stdout is valid JSON that can be parsed without error",
    severityIfFailed: "major",
    implementationStatus: "implemented",
  },
  {
    id: "warnings-go-to-stderr",
    title: "Warnings go to stderr, not stdout",
    category: "cli-adversarial",
    attackSurface: "all commands",
    inputExamples: ["run any command that emits a warning; capture stdout and stderr separately"],
    expectedBehavior: "Warning messages appear only on stderr; stdout is not contaminated",
    severityIfFailed: "major",
    implementationStatus: "implemented",
  },
  {
    id: "progress-not-in-json-stdout",
    title: "Progress output does not corrupt JSON stdout",
    category: "cli-adversarial",
    attackSurface: "all commands that emit progress messages",
    inputExamples: ["run a long-running index with progress messages; parse stdout as JSON"],
    expectedBehavior: "stdout remains valid JSON even when progress or status messages are emitted",
    severityIfFailed: "major",
    implementationStatus: "implemented",
  },
  {
    id: "json-error-object-on-failure",
    title: "Valid JSON error object returned on failure in JSON mode",
    category: "cli-adversarial",
    attackSurface: "--format json with an error condition",
    inputExamples: ["--format json --root /nonexistent"],
    expectedBehavior: "stdout is a valid JSON object with an error field; not a raw stack trace",
    severityIfFailed: "minor",
    implementationStatus: "implemented",
  },

  // ---------------------------------------------------------------------------
  // Graphviz and subprocess tests
  // ---------------------------------------------------------------------------
  {
    id: "dot-output-no-graphviz",
    title: "DOT output does not require Graphviz",
    category: "cli-adversarial",
    attackSurface: "DOT/graph output commands",
    inputExamples: ["run a graph command that produces DOT output; do not install Graphviz"],
    expectedBehavior: "DOT text is written successfully without Graphviz being installed",
    severityIfFailed: "major",
    implementationStatus: "planned",
  },
  {
    id: "svg-png-safe-without-graphviz",
    title: "SVG/PNG generation fails safely when Graphviz is unavailable",
    category: "cli-adversarial",
    attackSurface: "SVG/PNG graph rendering",
    inputExamples: ["request SVG or PNG output without Graphviz installed"],
    expectedBehavior: "Clear error explaining Graphviz is required; no crash; DOT output is still available",
    severityIfFailed: "minor",
    implementationStatus: "planned",
  },
  {
    id: "graphviz-label-escaping",
    title: "Graph labels escape quotes and shell metacharacters",
    category: "cli-adversarial",
    attackSurface: "DOT label generation",
    inputExamples: ["node name with double quote: foo\"bar", "node name with backslash: foo\\bar", "path with semicolon: foo;bar"],
    expectedBehavior: "All special characters in DOT labels are properly escaped; no broken DOT syntax or injection",
    severityIfFailed: "major",
    implementationStatus: "implemented",
  },
  {
    id: "subprocess-no-shell-interpolation",
    title: "Subprocess calls avoid shell-string interpolation",
    category: "cli-adversarial",
    attackSurface: "all child_process invocations",
    inputExamples: ["path with semicolon: /tmp/foo;rm -rf ~", "path with backtick: /tmp/`whoami`"],
    expectedBehavior: "Subprocess is invoked with an argument array, not a shell string; metacharacters are treated as literal path content",
    severityIfFailed: "blocker",
    implementationStatus: "implemented",
  },

  // ---------------------------------------------------------------------------
  // Secret leakage tests
  // ---------------------------------------------------------------------------
  {
    id: "env-values-not-indexed",
    title: ".env values are not indexed into generated artifacts",
    category: "secret-leakage",
    attackSurface: "indexer artifact generation",
    inputExamples: ["repo root containing a .env file with API_KEY=secret"],
    expectedBehavior: ".env content does not appear in manifest, symbol index, code graph, or data model artifacts",
    severityIfFailed: "blocker",
    implementationStatus: "planned",
  },
  {
    id: "token-patterns-not-emitted",
    title: "Common token patterns are not emitted in artifacts",
    category: "secret-leakage",
    attackSurface: "indexer artifact generation",
    inputExamples: ["source file containing a commented-out AWS key or GitHub token pattern"],
    expectedBehavior: "Artifacts do not contain raw secret values from source file comments or string literals",
    severityIfFailed: "major",
    implementationStatus: "planned",
  },
  {
    id: "ignored-dirs-excluded",
    title: "Ignored and generated directories are excluded from indexing",
    category: "secret-leakage",
    attackSurface: "indexer --root scan",
    inputExamples: ["node_modules/ with a package containing a .env file", ".git/ directory"],
    expectedBehavior: "Standard ignored directories are not indexed; their content does not appear in artifacts",
    severityIfFailed: "major",
    implementationStatus: "planned",
  },

  // ---------------------------------------------------------------------------
  // Scale and robustness tests
  // ---------------------------------------------------------------------------
  {
    id: "huge-source-file",
    title: "Huge source file is handled safely",
    category: "cli-adversarial",
    attackSurface: "indexer and source reader",
    inputExamples: ["a .ts file with 100,000 lines"],
    expectedBehavior: "Indexer completes or fails gracefully without running out of memory or hanging indefinitely",
    severityIfFailed: "major",
    implementationStatus: "implemented",
  },
  {
    id: "huge-literal",
    title: "Huge string literal is handled safely",
    category: "cli-adversarial",
    attackSurface: "TS/TSX analyzer",
    inputExamples: ["a single string literal with 1 million characters"],
    expectedBehavior: "Analyzer does not hang or run out of memory processing the literal",
    severityIfFailed: "minor",
    implementationStatus: "planned",
  },
  {
    id: "deeply-nested-tsx",
    title: "Deeply nested TSX is handled safely",
    category: "cli-adversarial",
    attackSurface: "TSX frontend analyzer",
    inputExamples: ["TSX with 500 levels of nesting"],
    expectedBehavior: "Analyzer completes or fails with a clear depth-limit error; no stack overflow",
    severityIfFailed: "minor",
    implementationStatus: "implemented",
  },
  {
    id: "many-duplicate-strings",
    title: "Many duplicate strings do not cause unbounded growth",
    category: "cli-adversarial",
    attackSurface: "symbol index and data model",
    inputExamples: ["10,000 files each containing the string 'TODO'"],
    expectedBehavior: "Artifact size remains bounded; deduplication or truncation is applied where appropriate",
    severityIfFailed: "minor",
    implementationStatus: "planned",
  },
  {
    id: "many-graph-nodes-edges",
    title: "Many graph nodes and edges do not cause unbounded growth",
    category: "cli-adversarial",
    attackSurface: "code-graph builder and renderer",
    inputExamples: ["a project with 10,000 files and 100,000 import relationships"],
    expectedBehavior: "Graph artifact size is bounded; graph view renderer completes without hanging",
    severityIfFailed: "minor",
    implementationStatus: "implemented",
  },
  {
    id: "unicode-paths",
    title: "Unicode paths are handled safely",
    category: "cli-adversarial",
    attackSurface: "--root, --file, --out",
    inputExamples: ["--root /tmp/репозиторий", "--out /tmp/出力"],
    expectedBehavior: "All path operations handle Unicode without corruption or crash",
    severityIfFailed: "minor",
    implementationStatus: "planned",
  },

  // ---------------------------------------------------------------------------
  // CLI argument tests
  // ---------------------------------------------------------------------------
  {
    id: "empty-contains",
    title: "Empty --contains value is handled safely",
    category: "cli-adversarial",
    attackSurface: "--contains",
    inputExamples: ["--contains \"\"", "--contains ''"],
    expectedBehavior: "Returns an empty result set or a clear validation error; no crash",
    severityIfFailed: "minor",
    implementationStatus: "planned",
  },
  {
    id: "negative-context",
    title: "Negative --context value is rejected safely",
    category: "cli-adversarial",
    attackSurface: "--context",
    inputExamples: ["--context -1", "--context -100"],
    expectedBehavior: "Validation error with clear message; command does not execute with a negative context window",
    severityIfFailed: "minor",
    implementationStatus: "planned",
  },
  {
    id: "huge-context",
    title: "Huge --context value does not cause memory exhaustion",
    category: "cli-adversarial",
    attackSurface: "--context",
    inputExamples: ["--context 99999999"],
    expectedBehavior: "Command completes within memory limits or fails with a clear limit-exceeded error",
    severityIfFailed: "minor",
    implementationStatus: "planned",
  },
  {
    id: "unknown-node-id",
    title: "Unknown node ID produces a clear error",
    category: "cli-adversarial",
    attackSurface: "--node",
    inputExamples: ["--node nonexistent-node-id-xyz"],
    expectedBehavior: "Clear error message stating the node was not found; no crash",
    severityIfFailed: "minor",
    implementationStatus: "planned",
  },
  {
    id: "path-with-metacharacters",
    title: "Paths with spaces, quotes, semicolons, and Unicode are handled safely",
    category: "cli-adversarial",
    attackSurface: "--root, --out, --file, --index",
    inputExamples: ["path with space", "path with double quote", "path with semicolon", "path with Unicode"],
    expectedBehavior: "All path arguments are treated as literal strings; no shell injection; correct behavior on Windows and Unix",
    severityIfFailed: "major",
    implementationStatus: "implemented",
  },

  // ---------------------------------------------------------------------------
  // Package content tests
  // ---------------------------------------------------------------------------
  {
    id: "no-lab-output-in-tarball",
    title: "lab-output/ must not appear in the npm tarball",
    category: "package-content",
    attackSurface: "npm pack --dry-run file list",
    inputExamples: ["run npm pack --dry-run and inspect file list for lab-output/"],
    expectedBehavior: "No lab-output/ paths appear in the tarball file list",
    severityIfFailed: "blocker",
    implementationStatus: "planned",
  },
  {
    id: "no-my-dev-kit-artifacts-in-tarball",
    title: ".my-dev-kit/ must not appear in the npm tarball",
    category: "package-content",
    attackSurface: "npm pack --dry-run file list",
    inputExamples: ["run npm pack --dry-run and inspect file list for .my-dev-kit/"],
    expectedBehavior: "No .my-dev-kit/ paths appear in the tarball file list",
    severityIfFailed: "blocker",
    implementationStatus: "planned",
  },
  {
    id: "no-env-files-in-tarball",
    title: ".env files must not appear in the npm tarball",
    category: "package-content",
    attackSurface: "npm pack --dry-run file list",
    inputExamples: ["run npm pack --dry-run and inspect for .env, .env.local, .env.production"],
    expectedBehavior: "No .env files appear in the tarball file list",
    severityIfFailed: "blocker",
    implementationStatus: "planned",
  },
  {
    id: "no-private-docs-in-tarball",
    title: "Private planning docs must not appear in the npm tarball",
    category: "package-content",
    attackSurface: "npm pack --dry-run file list",
    inputExamples: ["check for docs/FINAL_BATCH_HANDOFF.txt, docs/coding_generation_guideline.md"],
    expectedBehavior: "Internal planning documents do not appear in the published tarball",
    severityIfFailed: "major",
    implementationStatus: "planned",
  },
];
