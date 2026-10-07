import { describe, expect, it } from "vitest";
import {
  DEFAULT_PATCH_BOUNDS,
  extractPatchCandidate,
  parseUnifiedDiff,
  validatePatchPolicy,
  type PatchPolicyRejectionCode
} from "../../../src/evaluation/agentSuccess/index.js";
import { FIX_PATCH, newFilePatch } from "../benchmarkSandbox/sandboxTestHelpers.js";

const PROTECTED = ["protected.txt", "tests/task.check.cjs"];

function parsedFiles(patch: string) {
  const parsed = parseUnifiedDiff(patch);
  if (!parsed.ok) throw new Error(`unexpected parse failure: ${parsed.code} ${parsed.message}`);
  return parsed.files;
}

function policyCodes(patch: string, protectedFiles: string[] = PROTECTED): PatchPolicyRejectionCode[] {
  const parsed = parseUnifiedDiff(patch);
  if (!parsed.ok) throw new Error(`unexpected parse failure: ${parsed.code} ${parsed.message}`);
  const result = validatePatchPolicy(parsed.files, { protectedFiles });
  return result.ok ? [] : result.rejections.map((rejection) => rejection.code);
}

describe("patch candidate extraction", () => {
  it.each(["diff", "patch", "Diff", "PATCH"])("RSP-016 extracts exactly one fenced %s block and ignores surrounding prose", (info) => {
    const proposal = `Here is the fix.\n\n\`\`\`${info}\n${FIX_PATCH}\`\`\`\n\nLet me know if you need more.`;
    const result = extractPatchCandidate(proposal);
    expect(result).toEqual({ ok: true, patch: FIX_PATCH });
  });

  it("RSP-016 accepts a fenced block with CRLF fence lines", () => {
    const result = extractPatchCandidate(`\`\`\`diff\r\n${FIX_PATCH}\`\`\`\r\n`);
    expect(result.ok).toBe(true);
  });

  it("RSP-017 extracts a raw unified diff, trimming leading whitespace and trailing blank lines", () => {
    expect(extractPatchCandidate(`\n\n  ${FIX_PATCH}\n\n\n`.replace("  diff", "diff"))).toEqual({ ok: true, patch: FIX_PATCH });
    const plain = "--- a/x.txt\n+++ b/x.txt\n@@ -1 +1 @@\n-a\n+b\n";
    expect(extractPatchCandidate(plain)).toEqual({ ok: true, patch: plain });
  });

  it("RSP-017 keeps a final context line that is a single space", () => {
    const patch = "--- a/x.txt\n+++ b/x.txt\n@@ -1,2 +1,2 @@\n-a\n+b\n \n";
    const result = extractPatchCandidate(patch);
    expect(result).toEqual({ ok: true, patch });
    expect(parseUnifiedDiff((result as { patch: string }).patch).ok).toBe(true);
  });

  it("RSP-018 rejects ambiguous, missing and empty candidates", () => {
    const twoFenced = `\`\`\`diff\n${FIX_PATCH}\`\`\`\ntext\n\`\`\`patch\n${FIX_PATCH}\`\`\``;
    expect(extractPatchCandidate(twoFenced)).toMatchObject({ ok: false, code: "AMBIGUOUS_CANDIDATES" });
    const fencedPlusRaw = `\`\`\`diff\n${FIX_PATCH}\`\`\`\n${FIX_PATCH}`;
    expect(extractPatchCandidate(fencedPlusRaw)).toMatchObject({ ok: false, code: "AMBIGUOUS_CANDIDATES" });
    expect(extractPatchCandidate("I changed the add function to use +.")).toMatchObject({ ok: false, code: "NO_CANDIDATE" });
    expect(extractPatchCandidate("```text\nnot a diff\n```")).toMatchObject({ ok: false, code: "NO_CANDIDATE" });
    expect(extractPatchCandidate("")).toMatchObject({ ok: false, code: "EMPTY" });
    expect(extractPatchCandidate("   \n ")).toMatchObject({ ok: false, code: "EMPTY" });
    expect(extractPatchCandidate(undefined)).toMatchObject({ ok: false, code: "EMPTY" });
    expect(extractPatchCandidate("```diff\n\n```")).toMatchObject({ ok: false, code: "EMPTY" });
  });

  it("RSP-019 enforces the byte and line bounds at and over the limit", () => {
    expect(DEFAULT_PATCH_BOUNDS).toEqual({ maxPatchBytes: 1_048_576, maxChangedPaths: 64, maxPatchLines: 20_000 });
    const header = "diff --git a/x b/x\n";
    const exact = header + "y".repeat(1_048_576 - header.length);
    expect(Buffer.byteLength(exact)).toBe(1_048_576);
    expect(extractPatchCandidate(exact).ok).toBe(true);
    expect(extractPatchCandidate(`${exact}y`)).toMatchObject({ ok: false, code: "PATCH_TOO_LARGE" });
    expect(extractPatchCandidate("é".repeat(600_000))).toMatchObject({ ok: false, code: "PATCH_TOO_LARGE" });

    const bounds = { maxPatchBytes: 10_000, maxChangedPaths: 64, maxPatchLines: 5 };
    expect(extractPatchCandidate("diff --git a/x b/x\n1\n2\n3\n4", bounds).ok).toBe(true);
    expect(extractPatchCandidate("diff --git a/x b/x\n1\n2\n3\n4\n5", bounds)).toMatchObject({ ok: false, code: "PATCH_TOO_MANY_LINES" });
  });

  it("RSP-019 enforces the changed-path bound at and over the limit", () => {
    const files = (count: number) => Array.from({ length: count }, (_, index) => newFilePatch(`gen/file${index}.txt`, "x\n")).join("");
    const parse = (count: number) => {
      const parsed = parseUnifiedDiff(files(count));
      if (!parsed.ok) throw new Error(parsed.message);
      return parsed.files;
    };
    expect(validatePatchPolicy(parse(64), { protectedFiles: [] }).ok).toBe(true);
    const over = validatePatchPolicy(parse(65), { protectedFiles: [] });
    expect(over.ok).toBe(false);
    expect(!over.ok && over.rejections[0]?.code).toBe("TOO_MANY_PATHS");
    expect(validatePatchPolicy(parse(3), { protectedFiles: [], bounds: { ...DEFAULT_PATCH_BOUNDS, maxChangedPaths: 2 } }).ok).toBe(false);
  });
});

describe("unified diff parsing and policy", () => {
  it("RSP-020 rejects unsafe paths", () => {
    const at = (p: string) => newFilePatch(p, "x\n");
    expect(policyCodes(at("../escape.txt"))).toContain("UNSAFE_PATH");
    expect(policyCodes(at(".git/config"))).toContain("UNSAFE_PATH");
    expect(policyCodes(at("sub/.git/hooks/pre-commit"))).toContain("UNSAFE_PATH");
    expect(policyCodes(at("C:/Windows/system.ini"))).toContain("UNSAFE_PATH");
    expect(policyCodes(at("/etc/passwd"))).toContain("UNSAFE_PATH");
    expect(policyCodes(at("a/../../b.txt"))).toContain("UNSAFE_PATH");
  });

  it("RSP-020 rejects binary, rename, copy, symlink and submodule changes", () => {
    const binary = "diff --git a/x.bin b/x.bin\nnew file mode 100644\nindex 0000000..1111111\nBinary files /dev/null and b/x.bin differ\n";
    expect(policyCodes(binary)).toContain("BINARY_PATCH");
    const gitBinary = "diff --git a/x.bin b/x.bin\nnew file mode 100644\nindex 0000000..1111111\nGIT binary patch\nliteral 4\nLcmZQzU|?`Z\n\n";
    expect(policyCodes(gitBinary)).toContain("BINARY_PATCH");
    const rename = "diff --git a/old.txt b/new.txt\nsimilarity index 100%\nrename from old.txt\nrename to new.txt\n";
    expect(policyCodes(rename)).toContain("RENAME_OR_COPY");
    const renameWithHunk = "diff --git a/old.txt b/new.txt\nsimilarity index 90%\nrename from old.txt\nrename to new.txt\n--- a/old.txt\n+++ b/new.txt\n@@ -1 +1 @@\n-a\n+b\n";
    expect(policyCodes(renameWithHunk)).toEqual(expect.arrayContaining(["RENAME_OR_COPY", "PATH_MISMATCH"]));
    const copy = "diff --git a/old.txt b/copy.txt\nsimilarity index 100%\ncopy from old.txt\ncopy to copy.txt\n";
    expect(policyCodes(copy)).toContain("RENAME_OR_COPY");
    const symlink = "diff --git a/link b/link\nnew file mode 120000\n--- /dev/null\n+++ b/link\n@@ -0,0 +1 @@\n+target.txt\n\\ No newline at end of file\n";
    expect(policyCodes(symlink)).toContain("SYMLINK_MODE");
    const submodule = "diff --git a/sub b/sub\nnew file mode 160000\n--- /dev/null\n+++ b/sub\n@@ -0,0 +1 @@\n+Subproject commit 1234567890123456789012345678901234567890\n";
    expect(policyCodes(submodule)).toContain("SUBMODULE");
    const subprojectOnly = newFilePatch("vendor/mod", "Subproject commit 1234567890123456789012345678901234567890\n");
    expect(policyCodes(subprojectOnly)).toContain("SUBMODULE");
  });

  it("RSP-020 rejects any change touching a protected file, including deletions and mode-only changes", () => {
    const modify = "diff --git a/protected.txt b/protected.txt\n--- a/protected.txt\n+++ b/protected.txt\n@@ -1 +1 @@\n-do not touch\n+touched\n";
    expect(policyCodes(modify)).toEqual(["PROTECTED_PATH"]);
    const remove = "diff --git a/tests/task.check.cjs b/tests/task.check.cjs\ndeleted file mode 100644\n--- a/tests/task.check.cjs\n+++ /dev/null\n@@ -1 +0,0 @@\n-x\n";
    expect(policyCodes(remove)).toContain("PROTECTED_PATH");
    const modeOnly = "diff --git a/protected.txt b/protected.txt\nold mode 100644\nnew mode 100755\n";
    expect(policyCodes(modeOnly)).toContain("PROTECTED_PATH");
    expect(policyCodes(newFilePatch("protected.txt", "x\n"))).toContain("PROTECTED_PATH");
  });

  it("RSP-020 reports parse failures for malformed, truncated and unsupported patches", () => {
    const code = (patch: string) => {
      const parsed = parseUnifiedDiff(patch);
      return parsed.ok ? "ok" : parsed.code;
    };
    expect(code("diff --git a/x b/x\n--- a/x\n+++ b/x\n@@ -1,2 +1,2 @@\n-a\n+b\n")).toBe("PATCH_MALFORMED");
    expect(code("diff --git a/x b/x\n--- a/x\n+++ b/x\n@@ -1 +1 @@\n-a\n+b\n+extra\n")).toBe("PATCH_MALFORMED");
    expect(code("diff --git a/x b/x\n--- a/x\n")).toBe("PATCH_MALFORMED");
    expect(code("diff --git a/x b/x\nmystery header\n")).toBe("PATCH_MALFORMED");
    expect(code("hello world\n")).toBe("PATCH_MALFORMED");
    expect(code("diff --git a/x b/x\n--- a/x\n+++ b/x\n@@ nonsense @@\n")).toBe("PATCH_MALFORMED");
    expect(code('diff --git "a/x y" "b/x y"\n--- "a/x y"\n+++ "b/x y"\n@@ -1 +1 @@\n-a\n+b\n')).toBe("UNSUPPORTED_PATH_QUOTING");
    expect(code("--- nodirectory\n+++ nodirectory\n@@ -1 +1 @@\n-a\n+b\n")).toBe("PATCH_MALFORMED");
    expect(code(FIX_PATCH)).toBe("ok");
  });

  it("RSP-021 does not reject a change to an unprotected file outside any allowed scope", () => {
    const patch = "diff --git a/docs/elsewhere.md b/docs/elsewhere.md\n--- a/docs/elsewhere.md\n+++ b/docs/elsewhere.md\n@@ -1 +1 @@\n-a\n+b\n";
    expect(policyCodes(patch)).toEqual([]);
    const parsed = parseUnifiedDiff(patch);
    const policy = parsed.ok ? validatePatchPolicy(parsed.files, { protectedFiles: PROTECTED }) : undefined;
    expect(policy).toEqual({ ok: true, files: [{ path: "docs/elsewhere.md", status: "modified" }] });
  });

  it("parses statuses for added, deleted, plain and multi-hunk patches", () => {
    const multi = "--- a/a.txt\n+++ b/a.txt\n@@ -1,2 +1,2 @@\n x\n-y\n+z\n@@ -10 +10 @@\n-p\n+q\n\\ No newline at end of file\n";
    const parsed = parseUnifiedDiff(multi);
    expect(parsed.ok && parsed.files[0]?.hunkCount).toBe(2);
    const remove = "diff --git a/gone.txt b/gone.txt\ndeleted file mode 100644\n--- a/gone.txt\n+++ /dev/null\n@@ -1 +0,0 @@\n-bye\n";
    const policy = validatePatchPolicy(parsedFiles(remove), { protectedFiles: [] });
    expect(policy).toEqual({ ok: true, files: [{ path: "gone.txt", status: "deleted" }] });
    const add = validatePatchPolicy(parsedFiles(newFilePatch("n.txt", "hi\n")), { protectedFiles: [] });
    expect(add).toEqual({ ok: true, files: [{ path: "n.txt", status: "added" }] });
  });
});
