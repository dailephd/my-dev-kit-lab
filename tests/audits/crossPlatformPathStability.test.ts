import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { normalizeAuditConfig } from "../../src/audits/core/auditConfig.js";
import { collectSourceFacts } from "../../src/audits/core/collectSourceFacts.js";
import { resolveAuditTarget } from "../../src/audits/core/auditTarget.js";
import { runAudit } from "../../src/audits/core/auditRunner.js";
import { scanProjectInventory, type ProjectInventorySnapshot } from "../../src/audits/core/projectInventory.js";
import { buildAuditReportModel } from "../../src/audits/report/auditReportModel.js";
import { writeAuditReports } from "../../src/audits/report/writeAuditReports.js";
import { DOCS_CODE_MISMATCH_DETECTOR } from "../../src/audits/codeRot/detectors/docsCodeMismatchDetector.js";
import { collectSourceOfTruth } from "../../src/audits/core/sourceOfTruth.js";
import { reportFilenamePrefix } from "../../src/securityValidation/validate/resolveTarget.js";

const cleanupDirs: string[] = [];

afterEach(() => {
  for (const dir of cleanupDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function makeTempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  cleanupDirs.push(dir);
  return dir;
}

function writeFile(root: string, relativePath: string, content = ""): void {
  const fullPath = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, content, "utf8");
}

function buildMixedLanguageFixture(prefix: string): string {
  const root = makeTempDir(prefix);
  writeFile(root, "package.json", JSON.stringify({ name: "mixed-language-fixture", version: "1.0.0", scripts: {} }));
  writeFile(root, "README.md", "# Mixed fixture\n");
  writeFile(root, "src/index.ts", "export function greet(name: string) {\n  return `hi ${name}`;\n}\n");
  writeFile(root, "src/util.js", "export function join(a, b) {\n  return `${a}-${b}`;\n}\n");
  writeFile(root, "src/lib.py", "def helper(name: str):\n    return name.upper()\n");
  writeFile(
    root,
    "src/main/java/com/example/Foo.java",
    "package com.example;\n\nimport java.util.List;\n\npublic class Foo {\n    public void run() {}\n}\n"
  );
  writeFile(
    root,
    "src/main/kotlin/com/example/FooService.kt",
    "package com.example\n\nimport kotlin.collections.List\n\nclass FooService {\n    fun run() {}\n}\n"
  );
  writeFile(root, "tests/example.test.ts", 'import { describe, it, expect } from "vitest";\ndescribe("ok", () => it("works", () => expect(true).toBe(true)));\n');
  return root;
}

function factsByPath(snapshot: Awaited<ReturnType<typeof collectSourceFacts>>) {
  return new Map(snapshot.files.map((file) => [file.relativePath, file]));
}

function summarizeFacts(file: { language: string; parseStatus: string; declarations: unknown; diagnostics: unknown }) {
  return {
    language: file.language,
    parseStatus: file.parseStatus,
    declarations: file.declarations,
    diagnostics: file.diagnostics,
  };
}

function withBackslashInventoryPaths(inventory: ProjectInventorySnapshot): ProjectInventorySnapshot {
  return {
    ...inventory,
    files: inventory.files.map((entry) => ({
      ...entry,
      relativePath: entry.relativePath.replace(/\//g, "\\"),
      normalizedPath: entry.normalizedPath.replace(/\//g, "\\"),
    })),
  };
}

async function runCodeRotAudit(toolRoot: string, targetRoot: string, outDir: string) {
  const config = normalizeAuditConfig({ target: targetRoot, types: "code-rot", out: outDir, failOn: "none" }, toolRoot);
  const target = resolveAuditTarget(targetRoot, toolRoot);
  const result = await runAudit({ config, toolRoot, target });
  const model = buildAuditReportModel(result, { target });
  const writeResult = writeAuditReports({ model, config, outDir });
  return { config, target, result, model, writeResult };
}

describe("cross-platform path stability — PATH1/PATH6 source-facts and inventory normalization", () => {
  it("keeps source-fact identity stable when inventory relative paths use Windows-style separators", async () => {
    const root = buildMixedLanguageFixture("path-stability-fixture-");
    const inventory = scanProjectInventory(root);
    const baseline = await collectSourceFacts(root, inventory);
    const backslashInventory = withBackslashInventoryPaths(inventory);
    const normalized = await collectSourceFacts(root.replace(/\\/g, "/"), backslashInventory);

    expect(normalized.files.map((file) => file.relativePath)).toEqual(baseline.files.map((file) => file.relativePath));

    const baselineByPath = factsByPath(baseline);
    const normalizedByPath = factsByPath(normalized);
    for (const [relativePath, file] of baselineByPath) {
      expect(normalizedByPath.has(relativePath)).toBe(true);
      expect(summarizeFacts(normalizedByPath.get(relativePath)!)).toEqual(summarizeFacts(file));
    }
  });

  it("keeps generated/vendor/build classifications stable when the target root is provided with POSIX separators", () => {
    const root = makeTempDir("inventory-with-generated-");
    writeFile(root, "package.json", JSON.stringify({ name: "role-fixture", version: "1.0.0" }));
    writeFile(root, "src/index.ts", "export const ok = true;\n");
    writeFile(root, "vendor/sdk/client.js", "module.exports = {};\n");
    writeFile(root, "generated/schema.ts", "export type Schema = { id: string };\n");
    writeFile(root, "build/output.js", "console.log('generated');\n");
    writeFile(root, "dist/bundle.js", "console.log('bundle');\n");

    const nativeInventory = scanProjectInventory(root);
    const posixInventory = scanProjectInventory(root.replace(/\\/g, "/"));
    const roleMap = (inventory: ProjectInventorySnapshot) =>
      Object.fromEntries(inventory.files.map((entry) => [entry.relativePath, entry.role]));

    expect(roleMap(posixInventory)).toEqual(roleMap(nativeInventory));
    expect(roleMap(nativeInventory)).toMatchObject({
      "vendor/sdk/client.js": "vendor",
      "generated/schema.ts": "generated",
      "src/index.ts": "source",
    });
    expect(roleMap(nativeInventory)["build/output.js"]).toBeUndefined();
  });
});

describe("cross-platform path stability — PATH2/PATH4 report writing for targets with spaces", () => {
  it("runs inventory, source facts, audit reports, and metadata correctly for a target path with spaces", async () => {
    const toolRoot = process.cwd();
    const targetRoot = buildMixedLanguageFixture("mixed language target with spaces ");
    const outDir = makeTempDir("audit output with spaces ");

    const inventory = scanProjectInventory(targetRoot);
    const sourceFacts = await collectSourceFacts(targetRoot, inventory);
    expect(inventory.totalScannedFileCount).toBeGreaterThanOrEqual(6);
    expect(sourceFacts.filesByLanguage.typescript).toBeGreaterThan(0);
    expect(sourceFacts.filesByLanguage.python).toBeGreaterThan(0);
    expect(sourceFacts.filesByLanguage.java).toBeGreaterThan(0);
    expect(sourceFacts.filesByLanguage.kotlin).toBeGreaterThan(0);

    const { model, writeResult } = await runCodeRotAudit(toolRoot, targetRoot, outDir);
    const resolvedOutDir = path.resolve(outDir);
    const parsed = JSON.parse(fs.readFileSync(writeResult.writtenPaths.find((file) => file.endsWith(".json"))!, "utf8"));

    expect(writeResult.writtenPaths.length).toBe(2);
    expect(writeResult.writtenPaths.every((file) => path.resolve(file).startsWith(resolvedOutDir))).toBe(true);
    expect(parsed.target.rootPath).toBe(path.resolve(targetRoot));
    expect(parsed.target.displayName).toBe("mixed-language-fixture");
    expect(model.target.rootPath).toBe(path.resolve(targetRoot));
    expect(fs.existsSync(path.join(targetRoot, "reports", "audits"))).toBe(false);
  });

  it("keeps explicit --out report outputs outside each target tree and does not overwrite across distinct outputs", async () => {
    const toolRoot = process.cwd();
    const targetA = buildMixedLanguageFixture("audit target with spaces ");
    const targetB = buildMixedLanguageFixture("audit-target_with-hyphen_");
    const outA = makeTempDir("code-rot output a ");
    const outB = makeTempDir("code-rot output b ");

    const runA = await runCodeRotAudit(toolRoot, targetA, outA);
    const runB = await runCodeRotAudit(toolRoot, targetB, outB);

    const resolvedOutA = path.resolve(outA);
    const resolvedOutB = path.resolve(outB);

    expect(runA.writeResult.writtenPaths.every((file) => path.resolve(file).startsWith(resolvedOutA))).toBe(true);
    expect(runB.writeResult.writtenPaths.every((file) => path.resolve(file).startsWith(resolvedOutB))).toBe(true);
    expect(runA.writeResult.writtenPaths).not.toEqual(runB.writeResult.writtenPaths);
    expect(fs.existsSync(path.join(targetA, "reports", "audits"))).toBe(false);
    expect(fs.existsSync(path.join(targetB, "reports", "audits"))).toBe(false);
    expect(runA.model.target.rootPath).toBe(path.resolve(targetA));
    expect(runB.model.target.rootPath).toBe(path.resolve(targetB));
  });
});

describe("cross-platform path stability — PATH3/PATH5 security report filename sanitization", () => {
  it("sanitizes drive-letter-like and path-like target names deterministically without dropping the package version", () => {
    expect(
      reportFilenamePrefix({
        isSelf: false,
        packageName: "C:/Program Files/My Tool",
        packageVersion: "0.3.3",
        targetRoot: "C:/Program Files/My Tool",
      })
    ).toBe("C-Program-Files-My-Tool-v0.3.3");

    expect(
      reportFilenamePrefix({
        isSelf: false,
        packageName: "C:\\Program Files\\My Tool",
        packageVersion: "0.3.3",
        targetRoot: "C:\\Program Files\\My Tool",
      })
    ).toBe("C-Program-Files-My-Tool-v0.3.3");
  });

  it("uses the external target basename when package metadata is absent and strips unsafe separator-like characters", () => {
    const prefix = reportFilenamePrefix({
      isSelf: false,
      packageName: null,
      packageVersion: null,
      targetRoot: "Z:\\Work\\slash-like target:alpha/beta",
    });

    expect(prefix).toBe("beta");
    expect(prefix.includes("/") || prefix.includes("\\") || prefix.includes(":")).toBe(false);
  });
});

describe("cross-platform path stability — LINE1/LINE2/LINE3 parser stability across LF and CRLF", () => {
  it("keeps Java and Kotlin source facts equivalent across LF and CRLF inputs", async () => {
    const root = makeTempDir("line-endings-java-kotlin-");
    writeFile(
      root,
      "src/main/java/com/example/LfJava.java",
      "package com.example;\n\nimport java.util.List;\n\npublic class LfJava {\n    public void run() {}\n}\n"
    );
    writeFile(
      root,
      "src/main/java/com/example/CrlfJava.java",
      "package com.example;\r\n\r\nimport java.util.List;\r\n\r\npublic class CrlfJava {\r\n    public void run() {}\r\n}\r\n"
    );
    writeFile(
      root,
      "src/main/kotlin/com/example/LfKotlin.kt",
      "package com.example\n\nimport kotlin.collections.List\n\nclass LfKotlin {\n    fun run() {}\n}\n"
    );
    writeFile(
      root,
      "src/main/kotlin/com/example/CrlfKotlin.kt",
      "package com.example\r\n\r\nimport kotlin.collections.List\r\n\r\nclass CrlfKotlin {\r\n    fun run() {}\r\n}\r\n"
    );

    const snapshot = await collectSourceFacts(root, scanProjectInventory(root));
    const byPath = factsByPath(snapshot);
    const javaLf = byPath.get("src/main/java/com/example/LfJava.java")!;
    const javaCrlf = byPath.get("src/main/java/com/example/CrlfJava.java")!;
    const kotlinLf = byPath.get("src/main/kotlin/com/example/LfKotlin.kt")!;
    const kotlinCrlf = byPath.get("src/main/kotlin/com/example/CrlfKotlin.kt")!;

    expect({
      parseStatus: javaLf.parseStatus,
      imports: javaLf.imports,
      declarations: javaLf.declarations.filter((decl) => decl.name !== "LfJava"),
      diagnostics: javaLf.diagnostics,
    }).toEqual({
      parseStatus: javaCrlf.parseStatus,
      imports: javaCrlf.imports,
      declarations: javaCrlf.declarations.filter((decl) => decl.name !== "CrlfJava"),
      diagnostics: javaCrlf.diagnostics,
    });

    expect({
      parseStatus: kotlinLf.parseStatus,
      imports: kotlinLf.imports,
      declarations: kotlinLf.declarations.filter((decl) => decl.name !== "LfKotlin"),
      diagnostics: kotlinLf.diagnostics,
    }).toEqual({
      parseStatus: kotlinCrlf.parseStatus,
      imports: kotlinCrlf.imports,
      declarations: kotlinCrlf.declarations.filter((decl) => decl.name !== "CrlfKotlin"),
      diagnostics: kotlinCrlf.diagnostics,
    });
  });

  it("collects mixed-language source facts correctly from a fixture with mixed LF and CRLF endings", async () => {
    const root = makeTempDir("mixed-line-endings-");
    writeFile(root, "package.json", JSON.stringify({ name: "mixed-line-endings", version: "1.0.0" }));
    writeFile(root, "src/index.ts", "export const ready = true;\r\n");
    writeFile(root, "src/util.js", "export function ping() {\n  return true;\n}\n");
    writeFile(root, "src/lib.py", "def helper():\r\n    return True\r\n");
    writeFile(root, "src/main/java/com/example/Foo.java", "package com.example;\r\n\r\npublic class Foo {\r\n}\r\n");
    writeFile(root, "src/main/kotlin/com/example/FooService.kt", "package com.example\n\nclass FooService\n");

    const snapshot = await collectSourceFacts(root, scanProjectInventory(root));

    expect(snapshot.filesByLanguage.typescript).toBe(1);
    expect(snapshot.filesByLanguage.javascript).toBe(1);
    expect(snapshot.filesByLanguage.python).toBe(1);
    expect(snapshot.filesByLanguage.java).toBe(1);
    expect(snapshot.filesByLanguage.kotlin).toBe(1);
    expect(snapshot.filesByParseStatus.parsed).toBe(5);
    expect(snapshot.files.flatMap((file) => file.diagnostics).some((diag) => /compiler|runtime/i.test(diag.message))).toBe(false);
    expect(snapshot.files.flatMap((file) => file.declarations.map((decl) => decl.name))).toEqual(
      expect.arrayContaining(["ready", "ping", "helper", "Foo", "FooService"])
    );
  });
});

describe("cross-platform path stability — LINE4 docs-code mismatch robustness", () => {
  it("keeps Java/Kotlin symbol matching and future/out-of-scope suppression stable with CRLF docs", async () => {
    const root = makeTempDir("docs-crlf-robustness-");
    writeFile(root, "package.json", JSON.stringify({ name: "docs-fixture", version: "1.0.0", scripts: {} }));
    writeFile(root, "src/main/java/com/example/Foo.java", "package com.example;\n\npublic class Foo {}\n");
    writeFile(root, "src/main/kotlin/com/example/FooService.kt", "package com.example\n\nclass FooService\n");
    writeFile(
      root,
      "README.md",
      [
        "Java support includes `com.example.Foo`.",
        "Kotlin support includes `com.example.FooService`.",
        "Android validation is planned for a future release.",
        "Gradle execution remains out of scope for this implementation.",
        "Maven execution remains out of scope for this implementation.",
      ].join("\r\n") + "\r\n"
    );

    const inventory = scanProjectInventory(root);
    const sourceOfTruth = collectSourceOfTruth(root, inventory);
    const sourceFacts = await collectSourceFacts(root, inventory);
    const target = resolveAuditTarget(undefined, root);
    const config = normalizeAuditConfig({}, root);
    const issues = await DOCS_CODE_MISMATCH_DETECTOR.run({ target, config, inventory, sourceOfTruth, sourceFacts });

    expect(issues.some((issue) => issue.title.includes("com.example.Foo"))).toBe(false);
    expect(issues.some((issue) => issue.title.includes("com.example.FooService"))).toBe(false);
    expect(issues.some((issue) => /android|gradle|maven/i.test(issue.title))).toBe(false);
  });
});
