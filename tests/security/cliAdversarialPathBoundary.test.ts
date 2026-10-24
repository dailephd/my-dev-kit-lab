import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  getAdversarialCliTarget,
  type AdversarialCliTarget,
} from "../../src/securityValidation/cliAdversarial/adversarialCliConfig.js";
import {
  ABSOLUTE_PATH_CASES,
  PATH_TRAVERSAL_CASES,
  SPACES_PATH_CASES,
  UNICODE_PATH_CASES,
  type PathTestInput,
} from "../../src/securityValidation/cliAdversarial/pathCases.js";
import {
  checkHarnessEscapeDetection,
  checkIndexPathTraversal,
  checkOutPathTraversal,
  checkPathWithSpaces,
  checkRootPathTraversal,
  checkSafeAbsolutePath,
  checkUnicodePath,
} from "../../src/securityValidation/cliAdversarial/pathBoundaryChecks.js";
import {
  createTempWorkspace,
  diffSnapshots,
  snapshotDir,
  snapshotTreeStrict,
} from "../../src/securityValidation/cliAdversarial/tempWorkspace.js";
import {
  classifyTraversalValue,
  proveContainment,
} from "../../src/securityValidation/cliAdversarial/traversalContainment.js";
import type { SecurityCheckResult } from "../../src/securityValidation/types.js";

// ---------------------------------------------------------------------------
// Test-owned stub CLIs (CommonJS so ancestor package scope cannot affect them).
// ---------------------------------------------------------------------------

const stubRoot = mkdtempSync(path.join(os.tmpdir(), "c4-stubs-"));
afterAll(() => rmSync(stubRoot, { recursive: true, force: true }));

const STUB_PRELUDE = `
const fs = require("fs");
const path = require("path");
const a = process.argv.slice(2);
let flag = null;
let val = null;
for (let i = 0; i < a.length; i++) {
  if (a[i] === "--out" || a[i] === "--index") { flag = a[i]; val = a[i + 1]; }
}
`;

function makeStubTarget(name: string, body: string): AdversarialCliTarget {
  const file = path.join(stubRoot, `${name}.cjs`);
  writeFileSync(file, STUB_PRELUDE + body, "utf8");
  return { nodeExec: process.execPath, cliArgs: [file], isRealTarget: false, timeoutMs: 20_000 };
}

/** Rejects any destination outside the declared directory; writes nothing there. */
const safeRejectingTarget = makeStubTarget(
  "safe-rejecting",
  `
const allowed = path.resolve(process.cwd(), flag === "--out" ? "output" : "index");
const rel = path.relative(allowed, path.resolve(val));
if (rel.startsWith("..") || path.isAbsolute(rel)) {
  process.stderr.write("rejected: destination outside the declared directory\\n");
  process.exit(2);
}
fs.mkdirSync(val, { recursive: true });
fs.writeFileSync(path.join(val, "manifest.json"), "{}", "utf8");
`
);

/** Records its working directory and the value, then writes nothing. */
function makeMarkerTarget(name: string): { target: AdversarialCliTarget; marker: string } {
  const marker = path.join(stubRoot, `${name}.marker`);
  const target = makeStubTarget(
    name,
    `fs.writeFileSync(${JSON.stringify(marker)}, process.cwd() + "\\n" + val, "utf8");\n`
  );
  return { target, marker };
}

/** Modifies a protected source file instead of (only) writing the destination. */
const sourceMutatingTarget = makeStubTarget(
  "source-mutating",
  `fs.writeFileSync(path.join(process.cwd(), "source", "index.ts"), "// tampered\\n", "utf8");\n`
);

const IS_WIN32 = process.platform === "win32";
const ESCAPING_CASE_IDS = PATH_TRAVERSAL_CASES.filter(
  // A backslash traversal is a literal filename (no escape) where backslash is not a separator.
  (c) => IS_WIN32 || c.id !== "traversal-dotdot-windows"
).map((c) => c.id);
const TRAVERSAL_CHECKS = [
  { flag: "--out", idStem: "path-traversal-out", check: checkOutPathTraversal },
  { flag: "--index", idStem: "path-traversal-index", check: checkIndexPathTraversal },
] as const;

// ---------------------------------------------------------------------------
// Harness infrastructure tests
// (These verify the temp workspace and detection mechanisms work correctly.)
// ---------------------------------------------------------------------------

describe("CLI adversarial path boundary — harness infrastructure", () => {
  it("creates temp workspace with expected directories", async () => {
    const workspace = createTempWorkspace("infra-test-");
    try {
      const { statSync } = await import("node:fs");
      expect(statSync(workspace.root).isDirectory()).toBe(true);
      expect(statSync(workspace.sourceDir).isDirectory()).toBe(true);
      expect(statSync(workspace.outputDir).isDirectory()).toBe(true);
      expect(statSync(workspace.outsideDir).isDirectory()).toBe(true);
    } finally {
      await workspace.cleanup();
    }
  });

  it("workspace root and outsideDir are different directories", async () => {
    const workspace = createTempWorkspace("infra-test-");
    try {
      expect(workspace.outsideDir).not.toBe(workspace.root);
      expect(workspace.outsideDir.startsWith(workspace.root)).toBe(false);
    } finally {
      await workspace.cleanup();
    }
  });

  it("snapshot captures files in source directory", async () => {
    const workspace = createTempWorkspace("infra-test-");
    try {
      const snapshot = snapshotDir(workspace.sourceDir);
      expect(snapshot.length).toBeGreaterThan(0);
      expect(snapshot.every((s) => s.contentHash.length > 0)).toBe(true);
      expect(snapshot.every((s) => s.relativePath.length > 0)).toBe(true);
    } finally {
      await workspace.cleanup();
    }
  });

  it("detects added files in diffSnapshots", async () => {
    const workspace = createTempWorkspace("infra-test-");
    try {
      const before = snapshotDir(workspace.sourceDir);
      const { writeFileSync } = await import("node:fs");
      writeFileSync(
        `${workspace.sourceDir}/new-file.ts`,
        "export const y = 2;\n",
        "utf8"
      );
      const after = snapshotDir(workspace.sourceDir);
      const diff = diffSnapshots(before, after);
      expect(diff.added).toContain("new-file.ts");
      expect(diff.modified).toHaveLength(0);
      expect(diff.removed).toHaveLength(0);
    } finally {
      await workspace.cleanup();
    }
  });

  it("detects modified files in diffSnapshots", async () => {
    const workspace = createTempWorkspace("infra-test-");
    try {
      const before = snapshotDir(workspace.sourceDir);
      const { writeFileSync } = await import("node:fs");
      writeFileSync(
        `${workspace.sourceDir}/index.ts`,
        "export const x = 999; // modified\n",
        "utf8"
      );
      const after = snapshotDir(workspace.sourceDir);
      const diff = diffSnapshots(before, after);
      expect(diff.modified).toContain("index.ts");
    } finally {
      await workspace.cleanup();
    }
  });

  it("detects removed files in diffSnapshots", async () => {
    const workspace = createTempWorkspace("infra-test-");
    try {
      const before = snapshotDir(workspace.sourceDir);
      const { rmSync } = await import("node:fs");
      rmSync(`${workspace.sourceDir}/utils.ts`);
      const after = snapshotDir(workspace.sourceDir);
      const diff = diffSnapshots(before, after);
      expect(diff.removed).toContain("utils.ts");
    } finally {
      await workspace.cleanup();
    }
  });

  it("snapshot of unchanged directory shows no diff", async () => {
    const workspace = createTempWorkspace("infra-test-");
    try {
      const before = snapshotDir(workspace.sourceDir);
      const after = snapshotDir(workspace.sourceDir);
      const diff = diffSnapshots(before, after);
      expect(diff.added).toHaveLength(0);
      expect(diff.modified).toHaveLength(0);
      expect(diff.removed).toHaveLength(0);
    } finally {
      await workspace.cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
// Harness escape detection self-test
// (Verifies the harness can detect writes outside the declared output dir.)
// ---------------------------------------------------------------------------

describe("CLI adversarial path boundary — harness escape detection", () => {
  it("harness detects when fake CLI writes outside workspace (self-test)", async () => {
    const target = getAdversarialCliTarget();
    const result = await checkHarnessEscapeDetection(target);

    if (result.status === "skipped") {
      // Running against real target — skip this self-test.
      expect(result.skippedReason).toBeTruthy();
      return;
    }

    expect(result.status).toBe("passed");
    expect(result.findings).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Path traversal checks
// ---------------------------------------------------------------------------

describe("CLI adversarial path boundary — path traversal via --root", () => {
  for (const testInput of PATH_TRAVERSAL_CASES) {
    it(`${testInput.id}: ${testInput.description}`, async () => {
      const target = getAdversarialCliTarget();
      const result = await checkRootPathTraversal(target, testInput);

      // The check passes if no writes escaped outside the workspace.
      // Exit code may be zero or non-zero depending on whether path exists.
      expect(result.status).toBe("passed");
      expect(result.findings.filter((f) => f.id.includes("escape"))).toHaveLength(0);
    });
  }
});

function expectEscapeFailure(result: SecurityCheckResult, idStem: string, testInput: PathTestInput): void {
  expect(result.status).toBe("failed");
  const escape = result.findings.find((f) => f.id === `${idStem}-${testInput.id}-escape`);
  expect(escape).toBeDefined();
  expect(escape?.severity).toBe("blocker");
  expect(escape?.affectedFiles?.some((f) => f.endsWith("manifest.json"))).toBe(true);
}

for (const { flag, idStem, check } of TRAVERSAL_CHECKS) {
  describe(`CLI adversarial path boundary — path traversal via ${flag}`, () => {
    // NEGATIVE CONTROL: the deliberately unsafe fake CLI writes to whatever the
    // flag points at. The escape must be detected at the attempted destination
    // (inside the disposable enclosure) even though the CLI exits zero and the
    // unrelated outsideDir sentinel is untouched.
    for (const testInput of PATH_TRAVERSAL_CASES) {
      it(`${testInput.id}: unsafe fake CLI is FAILED when it writes the escaped ${flag} destination`, async () => {
        const result = await check(getAdversarialCliTarget(), testInput);
        if (ESCAPING_CASE_IDS.includes(testInput.id)) {
          expectEscapeFailure(result, idStem, testInput);
        } else {
          // Backslash is a literal filename on this host: the destination stays
          // inside the declared directory, so nothing escaped.
          expect(result.status).toBe("passed");
          expect(result.findings).toHaveLength(0);
        }
      });

      // POSITIVE CONTROL: a CLI that rejects the traversal and writes nothing
      // outside the declared directory is a truthful PASS.
      it(`${testInput.id}: safe rejecting CLI passes for ${flag}`, async () => {
        const result = await check(safeRejectingTarget, testInput);
        expect(result.status).toBe("passed");
        expect(result.findings).toHaveLength(0);
      });
    }

    it("refuses unsafe absolute inputs before launch and never reports them as passed", async () => {
      const { target, marker } = makeMarkerTarget(`absolute-${flag.slice(2)}`);
      const refusedIds = IS_WIN32
        ? ABSOLUTE_PATH_CASES.map((c) => c.id)
        : ABSOLUTE_PATH_CASES.filter((c) => c.value.startsWith("/")).map((c) => c.id);
      expect(refusedIds.length).toBeGreaterThan(0);
      for (const testInput of ABSOLUTE_PATH_CASES.filter((c) => refusedIds.includes(c.id))) {
        const result = await check(target, testInput);
        expect(result.status).toBe("skipped");
        expect(result.skippedReason).toMatch(/^BLOCKED_BEFORE_LAUNCH: /);
        expect(existsSync(marker)).toBe(false);
      }
    });

    it("refuses excessive traversal depth before launch", async () => {
      const { target, marker } = makeMarkerTarget(`deep-${flag.slice(2)}`);
      const result = await check(target, {
        id: "traversal-excessive",
        description: "excessive depth",
        value: "../".repeat(40) + "etc/passwd",
        category: "traversal-relative",
        expectedRejection: true,
      });
      expect(result.status).toBe("skipped");
      expect(result.skippedReason).toMatch(/BLOCKED_BEFORE_LAUNCH: traversal depth 40 exceeds/);
      expect(existsSync(marker)).toBe(false);
    });

    it("detects a modification of the protected source directory, not just additions", async () => {
      const testInput = PATH_TRAVERSAL_CASES[0] as PathTestInput;
      const result = await check(sourceMutatingTarget, testInput);
      expect(result.status).toBe("failed");
      const escape = result.findings.find((f) => f.id === `${idStem}-${testInput.id}-escape`);
      expect(escape?.severity).toBe("blocker");
      expect(escape?.description).toContain("modified [");
      expect(escape?.affectedFiles?.some((f) => f.endsWith("index.ts"))).toBe(true);
    });

    it("reports a spawn failure as a finding instead of a pass", async () => {
      const result = await check(
        { nodeExec: path.join(stubRoot, "no-such-node-binary"), cliArgs: [], isRealTarget: false, timeoutMs: 5_000 },
        PATH_TRAVERSAL_CASES[0] as PathTestInput
      );
      expect(result.status).toBe("failed");
      expect(result.findings.some((f) => f.id.endsWith("-not-executed"))).toBe(true);
    });

    it("removes only its own enclosure and leaves unrelated files alone", async () => {
      const sentinel = path.join(stubRoot, `cleanup-sentinel-${flag.slice(2)}.txt`);
      writeFileSync(sentinel, "keep\n", "utf8");
      const { target, marker } = makeMarkerTarget(`cleanup-${flag.slice(2)}`);
      const result = await check(target, PATH_TRAVERSAL_CASES[2] as PathTestInput);
      expect(result.status).toBe("passed");
      const [cwd] = readFileSync(marker, "utf8").split("\n");
      let enclosure = cwd as string;
      while (!path.basename(enclosure).includes("-encl-")) {
        const parent = path.dirname(enclosure);
        if (parent === enclosure) throw new Error("enclosure not found above cwd");
        enclosure = parent;
      }
      expect(existsSync(enclosure)).toBe(false);
      expect(readFileSync(sentinel, "utf8")).toBe("keep\n");
    });
  });
}

describe("CLI adversarial path boundary — containment preflight (process-free)", () => {
  function nested(depth: number) {
    const workspace = createTempWorkspace("c4-unit-", { nestDepth: depth });
    return workspace;
  }

  it("classifies values according to host path semantics", () => {
    expect(classifyTraversalValue("../../package.json", "linux")).toEqual({ kind: "relative", nestDepth: 2 });
    expect(classifyTraversalValue("../../../../../../../etc/passwd", "linux")).toEqual({ kind: "relative", nestDepth: 7 });
    expect(classifyTraversalValue("a/../../x", "linux")).toEqual({ kind: "relative", nestDepth: 1 });
    // Backslash: separator on win32, literal filename on POSIX.
    expect(classifyTraversalValue("..\\..\\package.json", "win32")).toEqual({ kind: "relative", nestDepth: 2 });
    expect(classifyTraversalValue("..\\..\\package.json", "linux")).toEqual({ kind: "relative", nestDepth: 0 });
    expect(classifyTraversalValue("C:\\Windows\\System32", "linux")).toEqual({ kind: "relative", nestDepth: 0 });
    expect(classifyTraversalValue("C:\\Windows\\System32", "win32").kind).toBe("refused");
    expect(classifyTraversalValue("C:relative", "win32").kind).toBe("refused");
    expect(classifyTraversalValue("/etc/hosts", "linux").kind).toBe("refused");
    expect(classifyTraversalValue("/etc/hosts", "win32").kind).toBe("refused");
    expect(classifyTraversalValue("\\\\server\\share", "win32").kind).toBe("refused");
    expect(classifyTraversalValue("name::$DATA", "win32").kind).toBe("refused");
    expect(classifyTraversalValue("trailing. ", "win32").kind).toBe("refused");
    expect(classifyTraversalValue("", "linux").kind).toBe("refused");
    expect(classifyTraversalValue("a\0b", "linux").kind).toBe("refused");
    expect(classifyTraversalValue("../".repeat(11) + "x", "linux").kind).toBe("refused");
  });

  for (const [flagName, baseKey] of [["--out", "outputDir"], ["--index", "indexDir"]] as const) {
    it(`two-parent traversal for ${flagName} resolves inside the enclosure but outside the declared directory`, () => {
      const ws = nested(2);
      try {
        const proof = proveContainment({
          value: "../../package.json",
          baseDir: ws[baseKey],
          enclosureDir: ws.enclosureDir as string,
          declaredDir: ws[baseKey],
        });
        expect(proof.ok).toBe(true);
        if (!proof.ok) return;
        expect(proof.relativeToEnclosure).toBe("d1/d2/package.json");
        expect(proof.insideDeclared).toBe(false);
        expect(path.relative(proof.enclosure, proof.destination).startsWith("..")).toBe(false);
      } finally {
        rmSync(ws.enclosureDir as string, { recursive: true, force: true });
      }
    });

    it(`seven-parent traversal for ${flagName} resolves inside the enclosure but outside the declared directory`, () => {
      const ws = nested(7);
      try {
        const proof = proveContainment({
          value: "../../../../../../../etc/passwd",
          baseDir: ws[baseKey],
          enclosureDir: ws.enclosureDir as string,
          declaredDir: ws[baseKey],
        });
        expect(proof.ok).toBe(true);
        if (!proof.ok) return;
        expect(proof.relativeToEnclosure).toBe("d1/d2/etc/passwd");
        expect(proof.insideDeclared).toBe(false);
        // The same value against a shallower nesting would leave the enclosure and is refused.
        const shallow = nested(4);
        try {
          const refused = proveContainment({
            value: "../../../../../../../etc/passwd",
            baseDir: shallow[baseKey],
            enclosureDir: shallow.enclosureDir as string,
            declaredDir: shallow[baseKey],
          });
          expect(refused.ok).toBe(false);
        } finally {
          rmSync(shallow.enclosureDir as string, { recursive: true, force: true });
        }
      } finally {
        rmSync(ws.enclosureDir as string, { recursive: true, force: true });
      }
    });
  }

  it("refuses a destination that crosses a symlink or junction", () => {
    const ws = nested(2);
    const linkTarget = mkdtempSync(path.join(os.tmpdir(), "c4-link-target-"));
    try {
      symlinkSync(linkTarget, path.join(ws.outputDir, "lnk"), IS_WIN32 ? "junction" : "dir");
      const proof = proveContainment({
        value: "lnk/x",
        baseDir: ws.outputDir,
        enclosureDir: ws.enclosureDir as string,
        declaredDir: ws.outputDir,
      });
      expect(proof.ok).toBe(false);
      if (!proof.ok) expect(proof.reason).toMatch(/symbolic link|junction|alias/);
    } finally {
      rmSync(ws.enclosureDir as string, { recursive: true, force: true });
      rmSync(linkTarget, { recursive: true, force: true });
    }
  });

  it("refuses a missing or uninspectable base directory", () => {
    const ws = nested(2);
    try {
      const proof = proveContainment({
        value: "../x",
        baseDir: path.join(ws.root, "does-not-exist"),
        enclosureDir: ws.enclosureDir as string,
        declaredDir: ws.outputDir,
      });
      expect(proof.ok).toBe(false);
    } finally {
      rmSync(ws.enclosureDir as string, { recursive: true, force: true });
    }
  });

  it.runIf(IS_WIN32)("refuses a path whose case differs from the on-disk spelling (win32)", () => {
    const ws = nested(2);
    try {
      const proof = proveContainment({
        value: "OUTPUT/x",
        baseDir: ws.root,
        enclosureDir: ws.enclosureDir as string,
        declaredDir: ws.outputDir,
      });
      expect(proof.ok).toBe(false);
      if (!proof.ok) expect(proof.reason).toMatch(/alias/);
    } finally {
      rmSync(ws.enclosureDir as string, { recursive: true, force: true });
    }
  });

  it("strict snapshot throws on an uninspectable tree and records directories", () => {
    const ws = nested(1);
    try {
      expect(() => snapshotTreeStrict(path.join(ws.root, "does-not-exist"))).toThrow();
      const entries = snapshotTreeStrict(ws.enclosureDir as string).map((e) => e.relativePath);
      expect(entries).toContain(path.join("d1", "ws", "output"));
      expect(entries).toContain(path.join("outside", "outside-sentinel.txt"));
    } finally {
      rmSync(ws.enclosureDir as string, { recursive: true, force: true });
    }
  });
});

describe("CLI adversarial path boundary — traversal checks leave protected paths untouched", () => {
  function stat(file: string): string {
    try {
      const s = statSync(file);
      return `${s.size}:${s.mtimeMs}`;
    } catch {
      return "absent";
    }
  }

  it("never creates or modifies etc/passwd/manifest.json under the checkout or drive root", async () => {
    const guarded = [
      path.resolve(process.cwd(), "etc", "passwd", "manifest.json"),
      path.join(path.parse(process.cwd()).root, "etc", "passwd", "manifest.json"),
    ];
    const before = guarded.map(stat);
    for (const { check } of TRAVERSAL_CHECKS) {
      for (const testInput of PATH_TRAVERSAL_CASES) {
        await check(getAdversarialCliTarget(), testInput);
      }
    }
    expect(guarded.map(stat)).toEqual(before);
  });
});

// ---------------------------------------------------------------------------
// Safe path handling checks
// ---------------------------------------------------------------------------

describe("CLI adversarial path boundary — safe path handling", () => {
  it("paths with spaces are handled as literal strings", async () => {
    const target = getAdversarialCliTarget();
    const result = await checkPathWithSpaces(target);
    expect(result.status).toBe("passed");
    expect(result.findings).toHaveLength(0);
  });

  it("safe absolute paths within workspace are accepted", async () => {
    const target = getAdversarialCliTarget();
    const result = await checkSafeAbsolutePath(target);
    expect(result.status).toBe("passed");
    expect(result.findings).toHaveLength(0);
  });

  for (const testInput of SPACES_PATH_CASES) {
    it(`spaces path case: ${testInput.description}`, async () => {
      const target = getAdversarialCliTarget();
      const result = await checkPathWithSpaces(target);
      expect(result.findings.filter((f) => f.severity === "blocker")).toHaveLength(0);
    });
  }

  for (const testInput of UNICODE_PATH_CASES) {
    it(`unicode path case: ${testInput.description}`, async () => {
      const target = getAdversarialCliTarget();
      const result = await checkUnicodePath(target, testInput.value);
      // Unicode paths must not cause spawn failures.
      expect(result.findings.filter((f) => f.severity === "major")).toHaveLength(0);
    });
  }
});

// ---------------------------------------------------------------------------
// Path test input catalog
// ---------------------------------------------------------------------------

describe("CLI adversarial path cases catalog", () => {
  it("path traversal cases are defined with required fields", () => {
    for (const c of PATH_TRAVERSAL_CASES) {
      expect(c.id).toBeTruthy();
      expect(c.description).toBeTruthy();
      expect(c.value).toBeTruthy();
      expect(c.category).toBe("traversal-relative");
    }
  });

  it("spaces path cases do not have expectedRejection set to true", () => {
    for (const c of SPACES_PATH_CASES) {
      expect(c.expectedRejection).toBe(false);
    }
  });

  it("unicode path cases do not have expectedRejection set to true", () => {
    for (const c of UNICODE_PATH_CASES) {
      expect(c.expectedRejection).toBe(false);
    }
  });
});
