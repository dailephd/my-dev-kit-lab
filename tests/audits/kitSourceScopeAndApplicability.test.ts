import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import { scanProjectInventory } from "../../src/audits/core/projectInventory.js";
import { collectKitSourceFacts, selectKitSourceRoots } from "../../src/audits/core/kitSourceProvider.js";
import { resolveApplicableKitRequirements, requiredKitCapabilitiesForPath, DEFAULT_AUDIT_REGISTRY, NON_SOURCE_DETECTOR_IDS } from "../../src/audits/core/auditRegistry.js";
import { assertRequiredCapabilities, assertSelectionCoversRequired, type KitFileRecord } from "../../src/audits/core/kitSourceEvidence.js";
import { runAudit } from "../../src/audits/core/auditRunner.js";
import { normalizeAuditConfig } from "../../src/audits/core/auditConfig.js";

const dirs: string[] = [];
function fixture(paths: string[]) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "kit-scope-"));
  dirs.push(root);
  for (const name of paths) {
    fs.mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
    fs.writeFileSync(path.join(root, name), "// selection witness\n");
  }
  return root;
}
afterAll(() => { for (const dir of dirs) fs.rmSync(dir, { recursive: true, force: true }); });
const include = ["docs", "tests", "package", "architecture", "cli"] as const;
const requirements = (root: string, id: string) => resolveApplicableKitRequirements([{ id }], scanProjectInventory(root), include);

describe("required JSON raw selection", () => {
  it.each(["dead-code-candidate", "test-rot"])("selects the unchanged Java %s decision's required raw test input", (id) => {
    const root = path.resolve("tests/fixtures/audits/kit-differential-v010/java");
    const inventory = scanProjectInventory(root);
    expect(inventory.testFiles.map((entry) => entry.relativePath)).toContain("tests/fixtures/payload.json");
    const required = requirements(root, id);
    expect(required.paths).toContain("tests/fixtures/payload.json");
    expect(requiredKitCapabilitiesForPath(required.requirements, "tests/fixtures/payload.json")).toEqual([]);
    expect(selectKitSourceRoots(root, inventory, required.paths).sourceRoots).toEqual(["src", "tests/fixtures"]);
  });

  it.each([
    [["src/a.ts", "tests/fixtures/a.json"], ["src", "tests/fixtures"]],
    [["src/a.ts", "src/tests/a.json"], ["src"]],
    [["tests/data/a.json", "tests/data/b.json"], ["tests/data"]],
    [["tests/data/a.json", "tests/data/nested/b.json"], ["tests/data"]],
  ])("normalizes required roots for %j", (files, expected) => {
    const root = fixture(files), inventory = scanProjectInventory(root);
    const scope = selectKitSourceRoots(root, inventory, files);
    expect(scope.complete).toBe(true);
    expect(scope.sourceRoots).toEqual(expected);
    expect(selectKitSourceRoots(root, inventory, [...files].reverse())).toEqual(scope);
  });

  it("does not select non-test or excluded JSON, or absent outside inputs", () => {
    const root = fixture(["src/a.ts", "config/data.json", "vendor/tests/a.json", "target/tests/a.json", "tests/package.json"]);
    const inventory = scanProjectInventory(root);
    expect(selectKitSourceRoots(root, inventory).sourceRoots).toEqual(["src"]);
    for (const file of ["config/data.json", "vendor/tests/a.json", "target/tests/a.json", "tests/package.json", "outside/a.json"]) {
      expect(selectKitSourceRoots(root, inventory, [file]).complete).toBe(false);
    }
    expect(() => selectKitSourceRoots(root, inventory, ["../outside.json"])).toThrow(/path-invalid/);
  });

  it("keeps source-only applicability free of JSON", () => {
    const root = fixture(["src/A.java", "tests/fixtures/a.json"]);
    expect(requirements(root, "duplicate-implementation-candidate").paths).toEqual(["src/A.java"]);
    expect(requirements(root, "package-release-rot").paths).toEqual([]);
    expect(resolveApplicableKitRequirements([{ id: "dead-code-candidate" }], scanProjectInventory(root), ["cli"]).paths).toEqual([]);
  });
});

describe("inventory-derived Kit scope", () => {
  it("selects generated raw paths only with an explicit source-category allowlist", () => {
    const root = fixture(["src/a.ts", "generated/nested/b.ts", "vendor/c.ts"]);
    const inventory = scanProjectInventory(root), file = "generated/nested/b.ts";
    expect(selectKitSourceRoots(root, inventory, [file]).complete).toBe(false);
    expect(selectKitSourceRoots(root, inventory, [file], [file])).toMatchObject({ complete: true, sourceRoots: ["generated/nested"] });
    const unknown = { ...inventory, files: inventory.files.map(e => e.relativePath === file ? { ...e, role: "unknown" as const } : e),
      sourceFiles: inventory.sourceFiles.map(e => e.relativePath === file ? { ...e, role: "unknown" as const } : e) };
    expect(selectKitSourceRoots(root, unknown, [file], [file]).complete).toBe(false);
    expect(selectKitSourceRoots(root, inventory, ["vendor/c.ts"]).complete).toBe(false);
    expect(selectKitSourceRoots(root, inventory, ["vendor/c.ts"], ["vendor/c.ts"])).toMatchObject({ complete: true, sourceRoots: ["vendor"] });
  });

  it("requests generated raw scope only for the existing dead-code reverse predicate", () => {
    const root = fixture(["src/a.ts", "generated/b.ts", "vendor/c.py"]);
    const required = requirements(root, "dead-code-candidate");
    expect(required.paths).toContain("generated/b.ts");
    expect(required.paths).toContain("vendor/c.py");
    expect(requiredKitCapabilitiesForPath(required.requirements, "generated/b.ts")).toEqual([]);
    expect(requirements(root, "duplicate-implementation-candidate").paths).not.toContain("generated/b.ts");
    const inventory = scanProjectInventory(root);
    expect(resolveApplicableKitRequirements([{ id: "dead-code-candidate" }], inventory, ["package"]).paths).not.toContain("generated/b.ts");
  });

  it("preserves exact-bound applicability while excluding overbound raw-only requirements", () => {
    const root = fixture(["src/a.ts", "generated/b.ts", "tests/check.test.ts", "tests/data.json"]);
    fs.writeFileSync(path.join(root, "generated/b.ts"), " ".repeat(200001));
    fs.writeFileSync(path.join(root, "tests/data.json"), " ".repeat(200001));
    fs.writeFileSync(path.join(root, "tests/check.test.ts"), " ".repeat(200000));
    const inventory = scanProjectInventory(root);
    expect(requirements(root, "dead-code-candidate").paths).not.toContain("generated/b.ts");
    expect(requirements(root, "dead-code-candidate").paths).not.toContain("tests/data.json");
    let req = resolveApplicableKitRequirements([{ id: "test-rot" }], inventory, include);
    expect(requiredKitCapabilitiesForPath(req.requirements, "tests/check.test.ts")).toContain("imports");
    fs.appendFileSync(path.join(root, "tests/check.test.ts"), " ");
    req = resolveApplicableKitRequirements([{ id: "test-rot" }], scanProjectInventory(root), include);
    expect(requiredKitCapabilitiesForPath(req.requirements, "tests/check.test.ts")).toEqual([]);
  });

  it.each([
    [["src/a.ts"], ["src"]],
    [["tests/check.test.ts"], ["tests"]],
    [["tests/check.test.ts", "src/a.ts"], ["src", "tests"]],
    [["py/a.py"], ["py"]],
    [["python/a.py"], ["python"]],
    [["project/ts/src/a.ts", "project/py/tests/test_a.py"], ["project"]],
    [["app/src/main/java/A.java", "lib/src/test/kotlin/ATest.kt"], ["app", "lib"]],
    [["scripts/a.mts", "scripts/nested/b.cjs"], ["scripts"]],
    [["src/a.ts", "src/nested/b.ts", "src/nested/deep/c.py"], ["src"]],
    [["main.py", "src/a.ts"], ["."]],
  ])("groups %j deterministically", (paths, roots) => {
    const root = fixture(paths);
    const inventory = scanProjectInventory(root);
    const scope = selectKitSourceRoots(root, inventory);
    expect(scope.sourceRoots).toEqual(roots);
    expect(scope.complete).toBe(true);
    expect(scope.requiredPaths).toEqual([...paths].sort());
    expect(selectKitSourceRoots(root, { ...inventory, files: [...inventory.files].reverse() })).toEqual(scope);
    expect(scope.widerSelection).toBe(roots.includes("."));
  });

  it("does not select generated/vendor/report/build paths", () => {
    const root = fixture(["src/a.ts", "generated/b.ts", "vendor/c.py", "dist/d.ts", "reports/e.ts"]);
    const inventory = scanProjectInventory(root);
    expect(selectKitSourceRoots(root, inventory).sourceRoots).toEqual(["src"]);
    const excluded = selectKitSourceRoots(root, inventory, ["generated/b.ts"]);
    expect(excluded.complete).toBe(false);
    expect(excluded.excludedPaths).toEqual(["generated/b.ts"]);
  });

  it("retains absent required roots and absent required files as unresolved", () => {
    const root = fixture(["src/a.ts"]);
    const inventory = scanProjectInventory(root);
    fs.unlinkSync(path.join(root, "src/a.ts"));
    const scope = selectKitSourceRoots(root, inventory, ["src/a.ts", "missing/b.py"]);
    expect(scope.complete).toBe(false);
    expect(scope.unresolvedPaths).toEqual(["missing/b.py", "src/a.ts"]);
    expect(scope.sourceRoots).toEqual([]);
  });

  it.each(["../outside.py", "src/../a.ts", "C:/outside.ts", "src\\a.ts", "/outside.py"])("rejects noncanonical required path %s", (name) => {
    const root = fixture(["src/a.ts"]);
    expect(() => selectKitSourceRoots(root, scanProjectInventory(root), [name])).toThrow(/path-invalid/);
  });

  it("rejects ambiguous Lab identities", () => {
    const root = fixture(["src/a.ts"]);
    const inventory = scanProjectInventory(root);
    inventory.files.push({ ...inventory.files[0]!, relativePath: "src/A.ts" });
    expect(() => selectKitSourceRoots(root, inventory)).toThrow(/ambiguous Lab file identity/);
  });

  it("rejects a required source directory replaced with a junction or directory symlink", () => {
    const root = fixture(["src/a.ts"]);
    const outside = fixture(["a.ts"]);
    const inventory = scanProjectInventory(root);
    fs.unlinkSync(path.join(root, "src/a.ts"));
    fs.rmdirSync(path.join(root, "src"));
    fs.symlinkSync(outside, path.join(root, "src"), process.platform === "win32" ? "junction" : "dir");
    const scope = selectKitSourceRoots(root, inventory);
    expect(scope.complete).toBe(false);
    expect(scope.unresolvedPaths).toEqual(["src/a.ts"]);
  });
});

describe("selected detector applicability", () => {
  it("does not drop unresolved applicability, and does not require optional enrichment", () => {
    const requirement = { path: "src/A.java", detectorId: "docs-code-mismatch", capability: "source-ranges" as const, applicability: "APPLICABLE_OPTIONAL" as const };
    expect(requiredKitCapabilitiesForPath([requirement], requirement.path)).toEqual([]);
    expect(() => requiredKitCapabilitiesForPath([{ ...requirement, applicability: "UNDETERMINED" }], requirement.path)).toThrow(/undetermined/);
  });
  it("requires docs declarations only for JVM source/test files", () => {
    const root = fixture(["README.md", "py/a.py", "src/A.java", "tests/ATest.kt"]);
    const actual = requirements(root, "docs-code-mismatch");
    expect(actual.paths).toEqual(["src/A.java", "tests/ATest.kt"]);
    expect(actual.requirements.find((r) => r.path === "py/a.py")?.applicability).toBe("NOT_APPLICABLE");
    expect(actual.requirements.find((r) => r.path === "src/A.java" && r.capability === "declarations")?.applicability).toBe("APPLICABLE_REQUIRED");
  });

  it("does not turn JVM configuration metadata into complete empty source evidence", async () => {
    const root = fixture(["README.md", "build.gradle.kts"]);
    const runCommand = vi.fn();
    await expect(runAudit({ config: normalizeAuditConfig({ target: root, types: "code-rot", include: "docs", failOn: "none" }, root),
      toolRoot: root, registry: DEFAULT_AUDIT_REGISTRY.filter((d) => d.id === "docs-code-mismatch"), sourceProviderMode: "kit",
      kitSourceProviderDependencies: { installedPackageRoot: path.join(root, "absent-kit"), runCommand } })).rejects.toMatchObject({ category: "selection-incomplete" });
    expect(runCommand).not.toHaveBeenCalled();
  });

  it("selects source import targets without demanding their imports for test-rot", () => {
    const root = fixture(["src/script.kts", "src/Alpha.kt", "src/test/AlphaTest.kt"]);
    const actual = requirements(root, "test-rot");
    expect(actual.paths).toEqual(["src/Alpha.kt", "src/script.kts", "src/test/AlphaTest.kt"]);
    expect(actual.requirements.filter((r) => r.applicability === "APPLICABLE_REQUIRED").map((r) => r.path)).toEqual(["src/test/AlphaTest.kt"]);
  });

  it("does not require duplicate declarations in test files", () => {
    const root = fixture(["src/a.ts", "tests/a.test.ts"]);
    expect(requirements(root, "duplicate-implementation-candidate").paths).toEqual(["src/a.ts"]);
  });

  it("selects test text for fixture occurrences in a tests-only dead-code audit without requiring imports", () => {
    const root = fixture(["src/a.ts", "tests/a.test.ts", "tests/fixtures/payload.json"]);
    const inventory = scanProjectInventory(root);
    const actual = resolveApplicableKitRequirements([{ id: "dead-code-candidate" }], inventory, ["tests"]);
    expect(actual.paths).toEqual(["tests/a.test.ts", "tests/fixtures/payload.json"]);
    expect(requiredKitCapabilitiesForPath(actual.requirements, "tests/a.test.ts")).toEqual([]);
    const noFixtures = { ...inventory, files: inventory.files.filter((entry) => !entry.relativePath.includes("/fixtures/")) };
    expect(resolveApplicableKitRequirements([{ id: "dead-code-candidate" }], noFixtures, ["tests"]).paths).toEqual([]);
  });

  it("keeps cross-platform source policy path-scoped", () => {
    const root = fixture(["src/audits/a.ts", "src/audits/textLines.ts", "py/a.py"]);
    expect(requirements(root, "cross-platform-rot").paths).toEqual(["src/audits/a.ts"]);
  });

  it("requires complete supported observations; partial or unsupported never proves absence", () => {
    const file = { path: "tests/a.test.ts", status: "parsed", capabilities: { imports: "complete", "test-observations": "unsupported" } } as unknown as KitFileRecord;
    expect(() => assertRequiredCapabilities(file, ["imports"])).not.toThrow();
    expect(() => assertRequiredCapabilities(file, ["test-observations"])).toThrow(/unsupported/);
    file.capabilities.imports = "partial";
    expect(() => assertRequiredCapabilities(file, ["imports"])).toThrow(/partial/);
  });

  it("avoids package resolution and acquisition for a non-source-only selection, with or without source", async () => {
    for (const files of [[], ["src/a.ts"]]) {
      const root = fixture(files);
      const runCommand = vi.fn();
      const result = await runAudit({ config: normalizeAuditConfig({ target: root, types: "code-rot", include: "docs,package,architecture,cli,tests", failOn: "none" }, root),
        toolRoot: root, registry: DEFAULT_AUDIT_REGISTRY.filter((d) => NON_SOURCE_DETECTOR_IDS.includes(d.id)), sourceProviderMode: "kit",
        kitSourceProviderDependencies: { installedPackageRoot: path.join(root, "absent-kit"), runCommand } });
      expect(runCommand).not.toHaveBeenCalled();
      expect(result.sourceFacts.provider).toBe("not-collected");
    }
  });

  it("fails an unresolved applicable selection before resolving Kit", async () => {
    const root = fixture(["src/a.ts"]);
    await expect(collectKitSourceFacts({ targetRoot: root, inventory: scanProjectInventory(root), requiredPaths: ["absent/a.ts"],
      requiredCapabilities: ["declarations"], includeScriptsRoot: false }, { installedPackageRoot: path.join(root, "absent-kit") })).rejects.toMatchObject({ category: "selection-incomplete" });
  });
});

describe("exact Kit-to-Lab inventory identity", () => {
  it("consumes validated facts from unconventional roots and retains unknown producer roles and provenance", async () => {
    const root = fixture([]);
    const files = {
      "src/a.ts": "export class A {}\n",
      "tests/fixtures/role.ts": "export class RoleWidget {}\n",
      "py/a.py": "class PyWidget:\n    pass\n",
      "python/b.py": "class PythonWidget:\n    pass\n",
      "project/nested/lib/c.js": "export class JsWidget {}\n",
      "app/src/main/java/JavaWidget.java": "public class JavaWidget {}\n",
      "app/src/main/kotlin/KotlinWidget.kt": "class KotlinWidget\n",
      "scripts/run.mts": "export class ScriptWidget {}\n",
    };
    for (const [name, content] of Object.entries(files)) {
      fs.mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
      fs.writeFileSync(path.join(root, name), content);
    }
    const facts = await collectKitSourceFacts({ targetRoot: root, inventory: scanProjectInventory(root), requiredCapabilities: ["declarations"], includeScriptsRoot: true },
      {  });
    expect(facts.kitEvidence?.sourceRoots).toEqual(["app", "project", "py", "python", "scripts", "src", "tests"]);
    expect(facts.files.map((file) => file.relativePath).sort()).toEqual(Object.keys(files).sort());
    const role = facts.files.find((file) => file.relativePath === "tests/fixtures/role.ts")!;
    expect(role.role).toBe("test");
    expect(role.kit?.producerRole).toBe("unknown");
    expect(role.declarations[0]?.provenance?.producer).toBe("kit");
    expect(role.declarations[0]?.provenance?.factId).toContain("audit-fact:");
    expect(facts.files.find((file) => file.relativePath === "py/a.py")?.diagnostics.some((d) => d.message.includes("process-observations is unsupported"))).toBe(true);
  }, 120_000);

  it("selects a required root-level file with an explicit wider-selection warning", async () => {
    const root = fixture([]);
    fs.writeFileSync(path.join(root, "main.py"), "class RootWidget:\n    pass\n");
    const facts = await collectKitSourceFacts({ targetRoot: root, inventory: scanProjectInventory(root), requiredCapabilities: ["declarations"], includeScriptsRoot: false },
      {  });
    expect(facts.kitEvidence?.sourceRoots).toEqual(["."]);
    expect(facts.files[0]?.declarations[0]?.name).toBe("RootWidget");
    expect(facts.warnings.join(" ")).toContain("--src .");
  }, 120_000);

  it("matches an unknown Kit role by canonical path", () => {
    expect(() => assertSelectionCoversRequired([{ path: "tests/fixtures/role.ts", role: "unknown" } as KitFileRecord], ["tests/fixtures/role.ts"])).not.toThrow();
  });
  it.each([
    [["src/a.ts"], ["src/b.ts"]],
    [["src/a.ts", "src/a.ts"], ["src/a.ts"]],
    [["src/a.ts", "src/A.ts"], ["src/a.ts"]],
    [["src/a.ts"], ["src/A.ts"]],
    [["src\\a.ts"], ["src/a.ts"]],
  ])("rejects incomplete/ambiguous/noncanonical identity %j -> %j", (selected, required) => {
    expect(() => assertSelectionCoversRequired(selected.map((p) => ({ path: p }) as KitFileRecord), required)).toThrow();
  });
});
