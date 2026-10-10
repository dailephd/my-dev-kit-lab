import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { applyPatchToSandbox } from "../../../src/evaluation/agentSuccess/index.js";
import { runSandboxGit, snapshotProjectTree } from "../../../src/evaluation/benchmarkSandbox/index.js";
import {
  FIX_PATCH,
  captureSandboxState,
  makeCanonicalFixture,
  makeSandbox,
  newFilePatch,
  useSandboxTestCleanup
} from "../benchmarkSandbox/sandboxTestHelpers.js";

useSandboxTestCleanup();

const PROTECTED = ["protected.txt", "tests/task.check.cjs"];

async function fixture() {
  const canonical = makeCanonicalFixture();
  const sandbox = await makeSandbox(canonical);
  return { canonical, sandbox };
}

describe("Lab-owned patch application", () => {
  it("RSP-023 applies a valid patch through the Git index", async () => {
    const { sandbox } = await fixture();
    const proposal = `Fixing it.\n\`\`\`diff\n${FIX_PATCH}${newFilePatch("docs/NEW.md", "# New\nline two\n")}\`\`\`\nDone.`;
    const result = await applyPatchToSandbox({ sandbox, rawProposal: proposal, protectedFiles: PROTECTED });

    expect(result).toEqual({
      outcome: "success",
      files: [
        { path: "docs/NEW.md", status: "added" },
        { path: "src/math.cjs", status: "modified" }
      ]
    });
    expect(readFileSync(path.join(sandbox.projectRoot, "src", "math.cjs"), "utf8")).toBe("module.exports.add = (a, b) => a + b;\n");
    expect(readFileSync(path.join(sandbox.projectRoot, "docs", "NEW.md"), "utf8")).toBe("# New\nline two\n");
    const cached = await runSandboxGit(sandbox, ["diff", "--cached", "--name-only"], { label: "t-cached" });
    expect(cached.stdout.split("\n").filter(Boolean).sort()).toEqual(["docs/NEW.md", "src/math.cjs"]);
  });

  it("RSP-023 applies a raw diff and a deletion", async () => {
    const { sandbox } = await fixture();
    const deletion = "diff --git a/src/other.cjs b/src/other.cjs\ndeleted file mode 100644\n--- a/src/other.cjs\n+++ /dev/null\n@@ -1 +0,0 @@\n-module.exports.id = (x) => x;\n";
    const result = await applyPatchToSandbox({ sandbox, rawProposal: `${FIX_PATCH}${deletion}`, protectedFiles: PROTECTED });
    expect(result.outcome).toBe("success");
    expect(() => readFileSync(path.join(sandbox.projectRoot, "src", "other.cjs"))).toThrow();
  });

  it("RSP-021 applies a change to an unprotected file outside the expected scope", async () => {
    const { sandbox } = await fixture();
    const patch = "diff --git a/docs/readme.md b/docs/readme.md\n--- a/docs/readme.md\n+++ b/docs/readme.md\n@@ -1 +1 @@\n-# Fixture\n+# Fixture changed\n";
    const result = await applyPatchToSandbox({ sandbox, rawProposal: patch, protectedFiles: PROTECTED });
    expect(result).toEqual({ outcome: "success", files: [{ path: "docs/readme.md", status: "modified" }] });
    expect(readFileSync(path.join(sandbox.projectRoot, "docs", "readme.md"), "utf8")).toBe("# Fixture changed\n");
  });

  it("RSP-022 leaves the sandbox unchanged when the Git check fails", async () => {
    const { sandbox } = await fixture();
    const before = await captureSandboxState(sandbox);
    // The first file would apply, the second has stale context: nothing may be applied.
    const stale = "diff --git a/src/other.cjs b/src/other.cjs\n--- a/src/other.cjs\n+++ b/src/other.cjs\n@@ -1 +1 @@\n-module.exports.id = (x) => x * 2;\n+module.exports.id = (x) => x + 1;\n";
    const result = await applyPatchToSandbox({ sandbox, rawProposal: `${FIX_PATCH}${stale}`, protectedFiles: PROTECTED });

    expect(result.outcome).toBe("git-check-failure");
    expect(await captureSandboxState(sandbox)).toEqual(before);
    expect(before.status).toBe("");
    expect(before.cachedNames).toBe("");
  });

  it("RSP-048 never alters the canonical source or the clean baseline when a patch fails", async () => {
    const { canonical, sandbox } = await fixture();
    const canonicalBefore = await snapshotProjectTree(canonical, { excludedNames: [] });
    const stateBefore = await captureSandboxState(sandbox);
    const proposals: Array<[string, string, string]> = [
      ["parse-failure", "I could not produce a patch.", "parse-failure"],
      ["parse-failure", `\`\`\`diff\n${FIX_PATCH}\`\`\`\n\`\`\`diff\n${FIX_PATCH}\`\`\``, "parse-failure"],
      ["parse-failure", "diff --git a/x b/x\n--- a/x\n+++ b/x\n@@ -1,3 +1,3 @@\n-a\n", "parse-failure"],
      ["policy-rejection", "diff --git a/protected.txt b/protected.txt\n--- a/protected.txt\n+++ b/protected.txt\n@@ -1 +1 @@\n-do not touch\n+touched\n", "policy-rejection"],
      ["policy-rejection", newFilePatch("../outside.txt", "x\n"), "policy-rejection"],
      ["policy-rejection", newFilePatch(".git/hooks/pre-commit", "#!/bin/sh\n"), "policy-rejection"],
      ["policy-rejection", "diff --git a/x.bin b/x.bin\nnew file mode 100644\nBinary files /dev/null and b/x.bin differ\n", "policy-rejection"],
      ["git-check-failure", "diff --git a/src/math.cjs b/src/math.cjs\n--- a/src/math.cjs\n+++ b/src/math.cjs\n@@ -1 +1 @@\n-no such line\n+x\n", "git-check-failure"],
      ["git-check-failure", "diff --git a/missing.txt b/missing.txt\n--- a/missing.txt\n+++ b/missing.txt\n@@ -1 +1 @@\n-a\n+b\n", "git-check-failure"],
      ["git-check-failure", newFilePatch("src/math.cjs", "already exists\n"), "git-check-failure"]
    ];
    for (const [label, proposal, expected] of proposals) {
      const result = await applyPatchToSandbox({ sandbox, rawProposal: proposal, protectedFiles: PROTECTED });
      expect(result.outcome, `${label}: ${proposal.slice(0, 40)}`).toBe(expected);
    }
    expect(await captureSandboxState(sandbox)).toEqual(stateBefore);
    expect(await snapshotProjectTree(canonical, { excludedNames: [] })).toEqual(canonicalBefore);
  });

  it("RSP-048 reports policy rejections with their codes and extraction failures with theirs", async () => {
    const { sandbox } = await fixture();
    const rejected = await applyPatchToSandbox({
      sandbox,
      rawProposal: "diff --git a/protected.txt b/protected.txt\n--- a/protected.txt\n+++ b/protected.txt\n@@ -1 +1 @@\n-do not touch\n+touched\n",
      protectedFiles: PROTECTED
    });
    expect(rejected).toMatchObject({ outcome: "policy-rejection", rejections: [{ code: "PROTECTED_PATH", path: "protected.txt" }] });
    const parse = await applyPatchToSandbox({ sandbox, rawProposal: "nothing here", protectedFiles: PROTECTED });
    expect(parse).toMatchObject({ outcome: "parse-failure", code: "NO_CANDIDATE" });
    const tooBig = await applyPatchToSandbox({ sandbox, rawProposal: FIX_PATCH, protectedFiles: PROTECTED, bounds: { maxPatchBytes: 10, maxChangedPaths: 64, maxPatchLines: 20_000 } });
    expect(tooBig).toMatchObject({ outcome: "parse-failure", code: "PATCH_TOO_LARGE" });
  });
});
