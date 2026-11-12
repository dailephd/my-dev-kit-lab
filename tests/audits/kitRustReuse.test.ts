import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { collectKitSourceFacts, selectKitSourceRoots, type KitSourceProviderDependencies, type KitSourceReader } from "../../src/audits/core/kitSourceProvider.js";
import { scanProjectInventory } from "../../src/audits/core/projectInventory.js";
import { DEFAULT_AUDIT_REGISTRY, resolveApplicableKitRequirements } from "../../src/audits/core/auditRegistry.js";
import { normalizeAuditConfig } from "../../src/audits/core/auditConfig.js";
import { runAudit } from "../../src/audits/core/auditRunner.js";
import { runMeasuredCommand } from "../../src/core/runMeasuredCommand.js";
import { KitSourceEvidenceAcquisitionError } from "../../src/audits/core/kitSourceEvidence.js";

const roots: string[] = [];
const corpus = path.resolve("tests/fixtures/audits/rust-reuse");
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "kit-rust-"));
  roots.push(root);
  fs.cpSync(corpus, root, { recursive: true });
  return root;
}
function write(root: string, name: string, text: string) {
  fs.mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
  fs.writeFileSync(path.join(root, name), text);
}
function hashTree(root: string): string {
  const walk = (dir: string): string[] => fs.readdirSync(dir).sort().flatMap(name => {
    const file = path.join(dir, name);
    return fs.statSync(file).isDirectory() ? walk(file) : [path.relative(root, file) + ":" + createHash("sha256").update(fs.readFileSync(file)).digest("hex")];
  });
  return createHash("sha256").update(walk(root).join("\n")).digest("hex");
}
afterAll(() => { for (const root of roots) fs.rmSync(root, { recursive: true, force: true }); });
const collect = (root: string, deps: KitSourceProviderDependencies = {}, requiredPaths?: string[]) => collectKitSourceFacts({
  targetRoot: root, inventory: scanProjectInventory(root), requiredCapabilities: ["declarations", "imports"], includeScriptsRoot: false, requiredPaths,
}, deps);
const audit = (root: string, ids: string[], deps: KitSourceProviderDependencies = {}, include = "package,tests,cli,architecture,docs") => runAudit({
  config: normalizeAuditConfig({ target: root, types: "code-rot", include, failOn: "none" }, root),
  toolRoot: process.cwd(), registry: DEFAULT_AUDIT_REGISTRY.filter(d => ids.includes(d.id)), kitSourceProviderDependencies: deps,
});

describe("published Kit Rust reuse", () => {
  it("authenticates ordinary Rust, preserves qualified owners and unsupported observations", async () => {
    const root = fixture(), before = hashTree(root);
    const installedKit = path.resolve("node_modules/@dailephd/my-dev-kit"), kitBefore = hashTree(installedKit);
    const facts = await collect(root);
    expect(facts.provider).toBe("kit");
    expect(facts.kitEvidence).toMatchObject({ packageVersion: "1.15.0", artifactSchemaVersion: "1.1.0", traversalComplete: true, selectedFileCount: 6 });
    expect(facts.files).toHaveLength(6);
    expect(facts.files.filter(file => file.language === "rust")).toHaveLength(5);
    for (const file of facts.files.filter(file => file.language === "rust")) {
      expect(file).toMatchObject({ language: "rust", parseStatus: "parsed", analyzerId: "kit:rust-tree-sitter" });
      expect(file.kit?.contentSha256).toBe(createHash("sha256").update(fs.readFileSync(path.join(root, file.relativePath))).digest("hex"));
      expect(file.kit?.capabilities).toMatchObject({ declarations: "complete", imports: "complete", exports: "partial", "identifier-literals": "unsupported", "test-observations": "unsupported", "fixture-references": "unsupported", "process-observations": "unsupported" });
      for (const declaration of file.declarations) expect(declaration.provenance).toMatchObject({ producer: "kit", extractionMethod: "rust-tree-sitter" });
    }
    const methods = facts.files.find(f => f.relativePath === "src/lib.rs")!.declarations.filter(d => d.name === "operate");
    expect(methods).toHaveLength(3);
    expect(new Set(methods.map(d => d.symbolId)).size).toBe(3);
    expect(new Set(methods.map(d => d.ownerKey)).size).toBe(3);
    expect(hashTree(root)).toBe(before);
    const repeated = await collect(root);
    expect(repeated.files).toEqual(facts.files);
    expect(repeated.kitEvidence?.snapshotId).toBe(facts.kitEvidence?.snapshotId);
    expect(hashTree(installedKit)).toBe(kitBefore);
  });

  it("uses existing duplicate, fixture-reference and raw cross-platform policies deterministically", async () => {
    const root = fixture();
    const ids = ["duplicate-implementation-candidate", "dead-code-candidate", "test-rot", "cross-platform-rot"];
    const result = await audit(root, ids);
    expect(result.exitCode).toBe(0);
    expect(result.detectorErrors).toEqual([]);
    expect(result.issues.some(i => i.detectorId === ids[0] && i.title.includes("calibrate_sensor") && i.severity === "info")).toBe(true);
    expect(result.issues.some(i => i.detectorId === ids[1] && i.title.includes("unused.json"))).toBe(true);
    expect(result.issues.filter(i => i.id.includes("unreferenced-source-file"))).toEqual([]);
    expect(result.issues.some(i => i.detectorId === ids[2] && i.title.includes("test.skip("))).toBe(true);
    expect(result.issues.some(i => i.detectorId === ids[3] && i.affectedFiles.includes("src/audits/lines.rs"))).toBe(true);
    expect(result.issues.some(i => /private_helper|operate|inspect/.test(i.title))).toBe(false);
    expect((await audit(root, ids)).issues).toEqual(result.issues);
    write(root, "src/secondary.rs", "fn calibrate_sensor() -> i32 { 7 }\nfn private_helper() {}\n");
    write(root, "src/audits/lines.rs", "pub fn records(input: &str) -> usize { input.lines().count() }\n");
    write(root, "tests/worker.rs", 'use rust_reuse::primary::calibrate_sensor;\n#[test]\nfn ordinary_test() { let _fixture = "unused.json"; assert_eq!(calibrate_sensor(), 42); }\n');
    const negative = await audit(root, ids);
    expect(negative.detectorErrors).toEqual([]);
    expect(negative.issues).toEqual([]);
    // Fixture-only applicability also remains clean; unavailable Rust file
    // target resolution never becomes a source-file absence candidate.
    expect((await audit(root, ["dead-code-candidate"], {}, "tests")).issues).toEqual([]);
  }, 180_000);

  it("keeps existing JVM-only and optional observation policies inapplicable", () => {
    const root = fixture(), inventory = scanProjectInventory(root);
    write(root, "README.md", "Ordinary Rust crate\n");
    const docs = resolveApplicableKitRequirements([{ id: "docs-code-mismatch" }], scanProjectInventory(root), ["docs"]);
    expect(docs.paths).toEqual([]);
    const duplicate = resolveApplicableKitRequirements([{ id: "duplicate-implementation-candidate" }], inventory, ["package"]);
    expect(duplicate.paths).toContain("src/lib.rs");
    expect(duplicate.requirements.filter(r => r.applicability === "APPLICABLE_REQUIRED").every(r => r.capability === "declarations")).toBe(true);
  });

  it.each([
    ["macro", "macro_rules! items { () => { pub fn hidden() {} } }\nitems!();\n"],
    ["cfg", '#[cfg(feature = "optional")]\npub fn conditional() {}\n'],
    ["recovery", "pub fn broken( {\n"],
    ["unsupported imports", "extern crate external;\n"],
  ])("rejects incomplete required %s evidence", async (_label, source) => {
    const root = fixture();
    write(root, "src/primary.rs", source);
    await expect(collect(root)).rejects.toMatchObject({ category: "capability-insufficient" });
  });

  it("does not invent missing Rust imports or run a Rust import resolver", async () => {
    const root = fixture();
    write(root, "tests/worker.rs", "use absent_crate::missing::Thing;\n#[test]\nfn ordinary_test() {}\n");
    const result = await audit(root, ["test-rot"]);
    expect(result.detectorErrors).toEqual([]);
    expect(result.issues).toEqual([]);
    expect(result.sourceFacts.files.find(f => f.relativePath === "tests/worker.rs")!.imports).toHaveLength(1);
  });

  it("fails rather than proving absence when a selected root or linked source escapes", async () => {
    const root = fixture(), inventory = scanProjectInventory(root);
    expect(() => selectKitSourceRoots(root, inventory, ["../outside.rs"])).toThrow(/path-invalid/);
    const outside = fixture();
    fs.rmSync(path.join(root, "src"), { recursive: true });
    fs.symlinkSync(path.join(outside, "src"), path.join(root, "src"), process.platform === "win32" ? "junction" : "dir");
    expect(selectKitSourceRoots(root, inventory, ["src/lib.rs"]).complete).toBe(false);
  });

  it("preserves selected-root exclusions and indeterminate Rust import proofs", async () => {
    const root = fixture();
    write(root, "src/primary.rs", "use crate::outside::Thing;\npub fn calibrate_sensor() {}\n");
    write(root, "src/outside.rs", "pub struct Thing;\n");
    write(root, "src/outside/mod.rs", "pub struct Thing;\n");
    fs.appendFileSync(path.join(root, "src/lib.rs"), "\npub mod outside;\n");
    let reader: KitSourceReader | undefined;
    try {
      const facts = await collectKitSourceFacts({ targetRoot: root, inventory: scanProjectInventory(root), requiredCapabilities: ["imports"],
        includeScriptsRoot: false, requiredPaths: ["src/primary.rs"], onReader: r => { reader = r; } });
      const imported = facts.files.find(f => f.relativePath === "src/primary.rs")!.imports[0]!;
      expect((await reader!.importTarget(imported.provenance!.factId)).status).toBe("indeterminate");
      expect(facts.files.some(file => file.relativePath === "tests/worker.rs")).toBe(false);
      expect(() => reader!.selectedFile("tests/worker.rs")).toThrow(/selection-incomplete/);
      expect(() => reader!.selectedFile("outside/Thing.rs")).toThrow();
    } finally { reader?.dispose(); }
  });

  it("rejects absent and mismatched managed producers without native fallback", async () => {
    const root = fixture(), wrong = fixture();
    write(wrong, "package.json", JSON.stringify({ name: "wrong-producer", version: "1.15.0" }));
    await expect(collect(root, { installedPackageRoot: wrong })).rejects.toMatchObject({ category: "package-identity" });
    await expect(collect(root, { installedPackageRoot: path.join(root, "absent-kit") })).rejects.toMatchObject({ category: "package-missing" });
  });

  it.each(["snapshot", "omission", "inventory truncation", "fact truncation", "hash", "process", "stale", "missing artifact", "digest", "registration"])("rejects %s evidence from the real Rust producer", async mode => {
    const root = fixture();
    let altered = false;
    const deps: KitSourceProviderDependencies = { runCommand: async options => {
      const result = await runMeasuredCommand(options);
      const args = options.args ?? [];
      if (args.includes("index")) {
        const out = args[args.indexOf("--out") + 1]!;
        const artifact = path.join(out, "source-audit-evidence.json");
        if (mode === "missing artifact") fs.unlinkSync(artifact);
        if (mode === "digest") fs.appendFileSync(artifact, " ");
        if (mode === "registration") {
          const file = path.join(out, "manifest.json"), manifest = JSON.parse(fs.readFileSync(file, "utf8"));
          delete manifest.sourceAuditEvidence;
          fs.writeFileSync(file, JSON.stringify(manifest));
        }
        if (mode === "stale") fs.appendFileSync(path.join(root, "src/lib.rs"), "// changed\n");
        if (["missing artifact", "digest", "registration", "stale", "process"].includes(mode)) altered = true;
        if (mode === "process") return { ...result, ok: false, exitCode: 2 };
      }
      if (result.ok && (args.includes("--audit-files") || args.includes("--audit-file"))) {
        const page = JSON.parse(result.stdout);
        if (mode === "snapshot") page.snapshotId = "0".repeat(64);
        if (args.includes("--audit-files")) {
          if (mode === "omission") page.files.pop();
          if (mode === "inventory truncation") page.nextPageIndex = 1;
          if (mode === "hash") page.files[0].contentSha256 = "0".repeat(64);
        }
        if (args.includes("--audit-file") && mode === "fact truncation") page.facts.pop();
        if (mode === "snapshot" || args.includes("--audit-files") && ["omission", "inventory truncation", "hash"].includes(mode) ||
            args.includes("--audit-file") && mode === "fact truncation") altered = true;
        return { ...result, stdout: JSON.stringify(page) };
      }
      return result;
    } };
    await expect(collect(root, deps)).rejects.toBeInstanceOf(KitSourceEvidenceAcquisitionError);
    expect(altered).toBe(true);
  });

  it("consumes terminal inventory and fact pages rather than retrieval rankings", async () => {
    const root = fixture();
    for (let i = 0; i < 65; i++) write(root, `src/page${i}.rs`, `pub fn witness_${i}() {}\n`);
    write(root, "src/large.rs", Array.from({ length: 140 }, (_, i) => `pub fn declaration_${i}() {}`).join("\n"));
    const result = await collect(root);
    expect(result.kitEvidence).toMatchObject({ selectedFileCount: 72, inventoryPages: 2, traversalComplete: true });
    expect(result.kitEvidence!.factPages).toBeGreaterThan(71);
    expect(result.files.find(f => f.relativePath === "src/large.rs")!.declarations).toHaveLength(140);
  });
});
