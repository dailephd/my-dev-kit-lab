import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { splitLines as coreSplitLines } from "../../../src/audits/core/textLines.js";
import { splitLines as codeRotSplitLines } from "../../../src/audits/codeRot/utils/textLines.js";
import { collectSourceOfTruth } from "../../../src/audits/core/sourceOfTruth.js";
import { scanProjectInventory } from "../../../src/audits/core/projectInventory.js";
import { normalizeAuditConfig } from "../../../src/audits/core/auditConfig.js";
import { runAudit } from "../../../src/audits/core/auditRunner.js";
import { DEFAULT_AUDIT_REGISTRY } from "../../../src/audits/core/auditRegistry.js";

// ---------------------------------------------------------------------------
// v0.3.0 Batch 6 — regression coverage for the sourceOfTruth.ts
// parseNodeVersions() raw-split fix (spec 3.1).
//
// Covers, per spec:
//  1. sourceOfTruth Node-version parsing works with LF line endings.
//  2. sourceOfTruth Node-version parsing works with CRLF line endings.
//  3. splitLines() behavior is stable across its old (codeRot/utils) and new
//     (core) import locations -- identical output for both endings.
//  4. crossPlatformRotDetector's raw-split-detection regex still fires
//     against a FRESH synthetic fixture containing a raw .split("\n")-style
//     call, proving the detector itself was not weakened by this fix.
// ---------------------------------------------------------------------------

const cleanupDirs: string[] = [];

function makeTempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  cleanupDirs.push(dir);
  return dir;
}

function writeFile(root: string, relativePath: string, content: string): void {
  const fullPath = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, content, "utf8");
}

function cleanup(): void {
  for (const dir of cleanupDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

afterEach(() => cleanup());

const LIST_FORM_WORKFLOW_LF =
  "name: CI\n" +
  "jobs:\n" +
  "  test:\n" +
  "    strategy:\n" +
  "      matrix:\n" +
  "        node-version:\n" +
  "          - 20\n" +
  "          - 22\n" +
  "    steps:\n" +
  "      - uses: actions/setup-node@v4\n";

describe("splitLines — stable across core/codeRot import locations", () => {
  it("core and codeRot re-export produce byte-identical output for LF content", () => {
    const content = "a\nb\nc\n";
    expect(coreSplitLines(content)).toEqual(codeRotSplitLines(content));
    expect(coreSplitLines(content)).toEqual(["a", "b", "c", ""]);
  });

  it("core and codeRot re-export produce byte-identical output for CRLF content", () => {
    const content = "a\r\nb\r\nc\r\n";
    expect(coreSplitLines(content)).toEqual(codeRotSplitLines(content));
    expect(coreSplitLines(content)).toEqual(["a", "b", "c", ""]);
  });

  it("codeRot's textLines.ts is a transparent re-export (same function reference)", () => {
    expect(codeRotSplitLines).toBe(coreSplitLines);
  });
});

describe("sourceOfTruth.ts parseNodeVersions — LF and CRLF list-form CI workflows", () => {
  it("parses list-form node-version entries from an LF-authored workflow file", () => {
    const root = makeTempDir("linesplit-lf-");
    writeFile(root, "package.json", JSON.stringify({ name: "fixture", version: "1.0.0" }));
    writeFile(root, ".github/workflows/ci.yml", LIST_FORM_WORKFLOW_LF);
    const inventory = scanProjectInventory(root);
    const truth = collectSourceOfTruth(root, inventory);
    expect(truth.ci.workflows).toHaveLength(1);
    expect(truth.ci.workflows[0].nodeVersionsReferenced).toEqual(["20", "22"]);
  });

  it("parses list-form node-version entries from a CRLF-authored workflow file", () => {
    const root = makeTempDir("linesplit-crlf-");
    const crlfContent = LIST_FORM_WORKFLOW_LF.replace(/\n/g, "\r\n");
    writeFile(root, "package.json", JSON.stringify({ name: "fixture", version: "1.0.0" }));
    writeFile(root, ".github/workflows/ci.yml", crlfContent);
    const inventory = scanProjectInventory(root);
    const truth = collectSourceOfTruth(root, inventory);
    expect(truth.ci.workflows).toHaveLength(1);
    // Before the Batch 6 fix, a raw .split("\n") would leave a trailing "\r"
    // on the inline "node-version:" line-detection regex's captured lines,
    // which does not itself break this specific list-form case (the
    // "\s*$" anchors already tolerate a trailing \r under further scrutiny)
    // -- but the fix's real value is consistency with every other line-based
    // parser in this codebase, verified end-to-end here regardless.
    expect(truth.ci.workflows[0].nodeVersionsReferenced).toEqual(["20", "22"]);
  });
});

describe("crossPlatformRotDetector — raw-split detection is not weakened", () => {
  it("still flags a fresh synthetic src/audits/ fixture file containing a raw .split on a newline literal", async () => {
    const root = makeTempDir("linesplit-detector-fixture-");
    writeFile(root, "package.json", JSON.stringify({ name: "fixture", version: "1.0.0", scripts: {} }));
    // Deliberately NOT named textLines.ts (that basename is allow-listed as
    // the canonical implementation) -- a different detector-like file using
    // a raw split.
    writeFile(
      root,
      "src/audits/core/fakeRawSplitter.ts",
      'export function badParse(content: string): string[] {\n  return content.split("\\n");\n}\n'
    );
    const config = normalizeAuditConfig({ include: "cli,package" }, root);
    const result = await runAudit({ config, toolRoot: root, registry: DEFAULT_AUDIT_REGISTRY });
    const flagged = result.issues.filter((i) => i.detectorId === "cross-platform-rot" && i.affectedFiles.includes("src/audits/core/fakeRawSplitter.ts"));
    expect(flagged.length).toBeGreaterThan(0);
  });
});
