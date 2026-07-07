// ---------------------------------------------------------------------------
// Adversarial path input definitions for CLI harness tests.
// These represent the attack surface entries from the security test matrix.
// ---------------------------------------------------------------------------

export type PathInputCategory =
  | "traversal-relative"
  | "traversal-absolute"
  | "spaces"
  | "metacharacters"
  | "unicode"
  | "long-name"
  | "missing"
  | "normal";

export type PathTestInput = {
  id: string;
  description: string;
  value: string;
  category: PathInputCategory;
  /**
   * Whether safe CLI behavior means this input should be REJECTED (true)
   * or ACCEPTED safely (false).
   *
   * Note: the harness does not rely on this field to determine pass/fail.
   * It always checks file boundary violations regardless of exit code.
   */
  expectedRejection: boolean;
};

// ---------------------------------------------------------------------------
// Path traversal cases
// ---------------------------------------------------------------------------

export const PATH_TRAVERSAL_CASES: PathTestInput[] = [
  {
    id: "traversal-dotdot-unix",
    description: "Unix-style ../.. traversal",
    value: "../../package.json",
    category: "traversal-relative",
    expectedRejection: true,
  },
  {
    id: "traversal-dotdot-windows",
    description: "Windows-style ..\\\\..\\ traversal",
    value: "..\\..\\package.json",
    category: "traversal-relative",
    expectedRejection: true,
  },
  {
    id: "traversal-many-levels",
    description: "Many levels of traversal",
    value: "../../../../../../../etc/passwd",
    category: "traversal-relative",
    expectedRejection: true,
  },
];

// ---------------------------------------------------------------------------
// Absolute path cases
// ---------------------------------------------------------------------------

export const ABSOLUTE_PATH_CASES: PathTestInput[] = [
  {
    id: "absolute-unix-etc",
    description: "Absolute Unix system path",
    value: "/etc/hosts",
    category: "traversal-absolute",
    expectedRejection: true,
  },
  {
    id: "absolute-unix-tmp",
    description: "Absolute Unix tmp path that may be different from workspace",
    value: "/tmp/escape-test-absolute",
    category: "traversal-absolute",
    expectedRejection: false, // May or may not be rejected depending on CLI
  },
  {
    id: "absolute-windows-system",
    description: "Absolute Windows system path",
    value: "C:\\Windows\\System32",
    category: "traversal-absolute",
    expectedRejection: true,
  },
];

// ---------------------------------------------------------------------------
// Safe path cases (should be handled correctly, not rejected)
// ---------------------------------------------------------------------------

export const SPACES_PATH_CASES: PathTestInput[] = [
  {
    id: "spaces-simple",
    description: "Path with a space",
    value: "my source dir",
    category: "spaces",
    expectedRejection: false,
  },
  {
    id: "spaces-multiple",
    description: "Path with multiple spaces",
    value: "my dev kit lab output",
    category: "spaces",
    expectedRejection: false,
  },
];

export const METACHAR_PATH_CASES: PathTestInput[] = [
  {
    id: "metachar-semicolon",
    description: "Path with semicolon",
    value: "output;rm-rf",
    category: "metacharacters",
    expectedRejection: false, // Should be treated as literal
  },
  {
    id: "metachar-quote",
    description: "Path with double quote",
    value: 'out"put',
    category: "metacharacters",
    expectedRejection: false,
  },
  {
    id: "metachar-ampersand",
    description: "Path with ampersand",
    value: "out&put",
    category: "metacharacters",
    expectedRejection: false,
  },
];

export const UNICODE_PATH_CASES: PathTestInput[] = [
  {
    id: "unicode-latin",
    description: "Path with accented Latin characters",
    value: "résultats",
    category: "unicode",
    expectedRejection: false,
  },
  {
    id: "unicode-cjk",
    description: "Path with CJK characters",
    value: "出力",
    category: "unicode",
    expectedRejection: false,
  },
];

export const LONG_NAME_CASES: PathTestInput[] = [
  {
    id: "long-name-200",
    description: "200-character directory name (within OS limits on most systems)",
    value: "a".repeat(200),
    category: "long-name",
    expectedRejection: false,
  },
];

export const MISSING_PATH_CASES: PathTestInput[] = [
  {
    id: "missing-dir",
    description: "Non-existent directory",
    value: "definitely-not-a-real-directory-xyz-123",
    category: "missing",
    expectedRejection: false, // CLI may create it or reject; harness checks results
  },
];

// ---------------------------------------------------------------------------
// All cases grouped by harness usage
// ---------------------------------------------------------------------------

export const ALL_PATH_TEST_INPUTS: PathTestInput[] = [
  ...PATH_TRAVERSAL_CASES,
  ...ABSOLUTE_PATH_CASES,
  ...SPACES_PATH_CASES,
  ...METACHAR_PATH_CASES,
  ...UNICODE_PATH_CASES,
  ...LONG_NAME_CASES,
  ...MISSING_PATH_CASES,
];
