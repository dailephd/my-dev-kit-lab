import fs from "node:fs";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { runAuditCommandFromArgs } from "../../src/commands/runAuditCommand.js";
import { runMeasuredCommand } from "../../src/core/runMeasuredCommand.js";
import { scanProjectInventory } from "../../src/audits/core/projectInventory.js";
import { collectKitSourceFacts, type KitSourceReader, type KitSourceProviderDependencies, QUALIFIED_CURRENT_PUBLISHED_KIT, QUALIFIED_B3_P1_KIT, QUALIFIED_B5_P1_R7A_KIT } from "../../src/audits/core/kitSourceProvider.js";

const installedPackageRoot = process.env.LAB_R3_INSTALLED_KIT;
const qualifiedArchivePath = process.env.LAB_R3_KIT_ARCHIVE;
const currentInstalledRoot = process.env.LAB_B5_P1_R7B_KIT_ROOT;
const currentArchive = process.env.LAB_B5_P1_R7B_KIT_ARCHIVE;
it.skipIf(!installedPackageRoot || !qualifiedArchivePath)(
  "runs the managed R3 candidate through the audit command and retains findings at every mandatory-gap threshold",
  async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "lab-r3-audit-"));
    const target = path.join(root, "target");
    fs.mkdirSync(path.join(target, "tests"), { recursive: true });
    fs.writeFileSync(path.join(target, "package.json"), '{"name":"fixture","type":"module"}\n');
    fs.writeFileSync(path.join(target, "tests/peer.mjs"), "export {};\n");
    fs.writeFileSync(path.join(target, "tests/only-source.mts"), "export {};\n");
    fs.writeFileSync(path.join(target, "tests/probe.test.mjs"), [
      'test.only("independent", () => {});',
      'void import("./peer");',
      'void import("./only-source.mjs");',
      'void import("./peer.mjs");',
      'void import("./p%65er.mjs");',
      'void import("./nested/%2e%2e/peer.mjs");',
      'void import(process.env.CHOOSE ? "./peer.mjs" : "./mixed-missing.mjs");',
      'void import(process.env.CHOOSE ? "./peer.mjs" : "unknown:operand");',
      'void import(process.env.CHOOSE ? "./missing-first.mjs" : "./missing-second.mjs");',
      'void import("./really-missing.mjs");',
      'void import(process.env.RUNTIME_UNKNOWN);',
    ].join("\n"));
    for (const threshold of ["none", "low", "medium", "high", "blocker"]) {
      const workspace = path.join(root, threshold);
      fs.mkdirSync(workspace);
      const out = path.join(workspace, "reports");
      const code = await runAuditCommandFromArgs([
        "--target", target, "--types", "code-rot", "--include", "tests",
        "--fail-on", threshold, "--format", "text,json", "--out", out,
      ], { evidenceWorkspace: workspace, kitSourceProviderDependencies: { installedPackageRoot, qualifiedArchivePath, expectation: QUALIFIED_B3_P1_KIT } });
      expect(code).toBe(2);
      const files = fs.readdirSync(out);
      const json = JSON.parse(fs.readFileSync(path.join(out, files.find(f => f.endsWith(".json"))!), "utf8"));
      expect(json.schemaVersion).toBe("1.0");
      expect(json.exit.code).toBe(2);
      expect(json.exit.breached).toBe(["low", "medium", "high"].includes(threshold));
      expect(json.issues.some((issue: { id: string }) => issue.id.includes("only"))).toBe(true);
      const missing = json.issues.filter((issue: { id: string }) => issue.id.includes("missing-source-import"));
      expect(missing).toHaveLength(1);
      expect(missing[0].id).toContain("really-missing");
      const gaps = json.detectorErrors.filter((error: { message: string }) => error.message.includes("Dynamic import evidence"));
      expect(gaps).toHaveLength(5);
      if (threshold === "none") {
        const evidence = path.join(workspace, "lab-output", "evidence");
        const [id] = fs.readdirSync(evidence);
        const dir = path.join(evidence, id!, "logs");
        const responses = fs.readdirSync(dir).filter(name => name.endsWith("import-domain.stdout.txt"))
          .map(name => JSON.parse(fs.readFileSync(path.join(dir, name), "utf8")));
        const byOperands = new Map(responses.map(response => [
          response.operandAlternatives.map((alternative: { specifier: string }) => alternative.specifier).join("|"), response,
        ]));
        for (const unresolved of ["./peer", "./only-source.mjs"]) {
          expect(byOperands.get(unresolved)).toMatchObject({
            originFile: "tests/probe.test.mjs", outcome: "finite", qualifiedPositiveWitnesses: [],
            operandAlternatives: [{ resolution: { status: "present" } }],
          });
        }
        for (const exact of ["./peer.mjs", "./p%65er.mjs", "./nested/%2e%2e/peer.mjs"]) {
          expect(byOperands.get(exact)?.qualifiedPositiveWitnesses).toMatchObject([{ targetPath: "tests/peer.mjs" }]);
        }
        expect(byOperands.get("./missing-first.mjs|./missing-second.mjs")?.outcome).toBe("disjoint-selected-domain");
      }
      expect(files.some(f => f.endsWith(".txt"))).toBe(true);
    }
  }, 180_000
);



it.skipIf(!installedPackageRoot || !qualifiedArchivePath)(
  "authenticates overlapping byte proofs and whole-file ambient facts through the managed reader",
  async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "lab-r3-content-"));
    const target = path.join(root, "target");
    fs.mkdirSync(path.join(target, "src"), { recursive: true });
    fs.writeFileSync(path.join(target, "src/anchor.ts"), 'void import("./peer.mjs");\n');
    fs.writeFileSync(path.join(target, "src/peer.mjs"), "export {};\n");
    fs.writeFileSync(path.join(target, "src/range-mixed.ts"), "// mixed\r\nexport {};\n");
    fs.writeFileSync(path.join(target, "src/stub.d.ts"), 'declare module "ambient-only";\n');
    fs.writeFileSync(path.join(target, "src/mixed.d.ts"), 'declare module "ambient-only";\nconst executable = () => 1;\n');
    fs.writeFileSync(path.join(target, "src/blob.bin"), Buffer.from([255, 0, 0, 0, 13, 10]));
    fs.writeFileSync(path.join(target, "src/capped.bin"), Buffer.alloc(201));
    let reader: KitSourceReader | undefined;
    const request = {
      targetRoot: target,
      inventory: scanProjectInventory(target),
      requiredPaths: ["src/anchor.ts", "src/stub.d.ts", "src/mixed.d.ts", "src/range-mixed.ts"],
      requiredCapabilities: [],
      includeScriptsRoot: false,
      onReader: (value: KitSourceReader) => { reader = value; },
    };
    const identity = { installedPackageRoot, qualifiedArchivePath, expectation: QUALIFIED_B3_P1_KIT, workDir: path.join(root, "kit") };
    let legacy: KitSourceReader | undefined;
    await collectKitSourceFacts({ ...request, onReader: (value: KitSourceReader) => { legacy = value; } }, {
      ...identity, expectation: { ...QUALIFIED_B3_P1_KIT, artifactSchemaVersion: "1.1.0" },
      workDir: path.join(root, "kit-legacy"),
    });
    try {
      expect(legacy?.expressionDomains).toBeUndefined();
      await expect(legacy?.occurrences("src/anchor.ts", "import")).resolves.toMatchObject({ complete: true });
    } finally { legacy?.dispose(); }
    fs.mkdirSync(path.join(target, "tests"));
    const jsonPath = "tests/window.json", clippedPath = "tests/clipped.json", binaryPath = "tests/binary.json";
    const rustPath = "src/malformed.rs";
    const window = "{\r\n  \"fixture\": \"caf\u00e9.json\"\r\n}\r\n";
    const clipped = JSON.stringify(Array.from({ length: 180 }, () => "near"), null, 2) + "\n";
    const malformed = "pub fn broken( {\n    let value = ;\n}\npub fn recovered() {}\n";
    fs.writeFileSync(path.join(target, jsonPath), window);
    fs.writeFileSync(path.join(target, clippedPath), clipped);
    fs.writeFileSync(path.join(target, binaryPath), Buffer.from([255, 0, 34]));
    const emptyPath = "tests/empty.json";
    fs.writeFileSync(path.join(target, emptyPath), "");
    fs.writeFileSync(path.join(target, rustPath), malformed);
    const extendedRequest = {
      ...request, inventory: scanProjectInventory(target),
      requiredPaths: [...request.requiredPaths, jsonPath, clippedPath, binaryPath, rustPath, emptyPath],
    };
    await expect(collectKitSourceFacts({
      ...request, expectedWholeProjectSnapshot: "0".repeat(64),
    }, { ...identity, workDir: path.join(root, "kit-frozen-mismatch") }))
      .rejects.toMatchObject({ category: "stale-evidence" });
    const tamperedArchive = path.join(root, "tampered.tgz");
    fs.writeFileSync(tamperedArchive, Buffer.concat([fs.readFileSync(qualifiedArchivePath!), Buffer.from([0])]));
    await expect(collectKitSourceFacts(request, { ...identity, qualifiedArchivePath: tamperedArchive })).rejects.toThrow(/package-identity/);
    const facts = await collectKitSourceFacts(extendedRequest, { ...identity, runCommand: async options => {
      const result = await runMeasuredCommand(options);
      if (result.ok && options.args?.includes("--audit-import-domain")) {
        const response = JSON.parse(result.stdout);
        response.selectedDomainDigest = "0".repeat(64);
        return { ...result, stdout: JSON.stringify(response) };
      }
      return result;
    } });
    try {
      const importFactId = facts.files.find(file => file.relativePath === "src/anchor.ts")?.imports
        .find(imp => imp.source === "./peer.mjs")?.provenance?.factId;
      expect(importFactId).toBeTruthy();
      await expect(reader?.importTarget(importFactId!)).resolves.toMatchObject({
        status: "present", candidatePaths: ["src/peer.mjs"],
      });
      await expect(reader?.expressionDomains?.("src/anchor.ts")).rejects.toThrow(/import domain identity/i);
      expect(reader?.ambientClassification?.("src/stub.d.ts")?.outcome).toBe("proven-ambient-only");
      expect(reader?.ambientClassification?.("src/mixed.d.ts")?.outcome).toBe("not-ambient-only");
      await expect(reader?.cachedAuthenticatedFixtureContent?.("src/anchor.ts")).resolves.toBeUndefined();
      await expect(reader?.authenticatedFixtureContent?.("src/anchor.ts"))
        .resolves.toBe('void import("./peer.mjs");\n');
      await expect(reader?.authenticatedFixtureContent?.("src/range-mixed.ts"))
        .rejects.toMatchObject({ category: "capability-insufficient" });
      await expect(reader?.cachedAuthenticatedFixtureContent?.("src/anchor.ts")).resolves.toBe('void import("./peer.mjs");\n');
      await expect(reader?.cachedAuthenticatedFixtureContent?.("src/range-mixed.ts")).resolves.toBeUndefined();
      expect(reader?.selectedFile(rustPath).status).toBe("partial");
      await expect(reader?.authenticatedFixtureContent?.(rustPath)).resolves.toBe(malformed);
      await expect(reader?.authenticatedFixtureContent?.(jsonPath)).resolves.toBe(window);
      expect(reader?.authenticatedRawTestContent?.(jsonPath)).toBe(window);
      expect(reader?.authenticatedRawTestContent?.(emptyPath)).toBe("");
      expect(reader?.authenticatedRawTestContent?.(binaryPath)).toBeUndefined();
      expect(reader?.authenticatedRawTestContent?.("src/anchor.ts")).toBeUndefined();
      fs.writeFileSync(path.join(target, jsonPath), window.replace("fixture", "altered"));
      expect(() => reader?.authenticatedRawTestContent?.(jsonPath)).toThrow(/stale-evidence/);
      await expect(reader?.authenticatedFixtureContent?.(clippedPath))
        .rejects.toMatchObject({ category: "capability-insufficient" });
      await expect(reader?.occurrences(clippedPath, "absent-fixture.json")).resolves.toMatchObject({ complete: true, matchCount: 0 });
      await expect(reader?.authenticatedFixtureContent?.(binaryPath))
        .rejects.toMatchObject({ category: "capability-insufficient" });
      await expect(reader?.byteOccurrences?.(binaryPath, "00")).resolves.toMatchObject({ complete: true, matchCount: 1 });
      await expect(reader?.byteOccurrences?.("src/range-mixed.ts", "6578706f7274"))
        .resolves.toMatchObject({ complete: true, matchCount: 1 });
      fs.writeFileSync(path.join(target, "src/anchor.ts"), 'void import("./else.mjs");\n');
      await expect(reader?.cachedAuthenticatedFixtureContent?.("src/anchor.ts")).rejects.toMatchObject({ category: "stale-evidence" });
      await expect(reader?.importTarget(importFactId!)).rejects.toMatchObject({ category: "stale-evidence" });
      expect(() => reader?.authenticatedFixtureContent?.("src/anchor.ts"))
        .toThrow(/stale-evidence/);
      await expect(reader?.byteOccurrences?.("src/blob.bin", "0000")).resolves.toMatchObject({
        complete: true, matchCount: 2, matches: [{ startByte: 1, endByteExclusive: 3 }, { startByte: 2, endByteExclusive: 4 }],
      });
      await expect(reader?.byteOccurrences?.("src/blob.bin", "abcd")).resolves.toMatchObject({ complete: true, matchCount: 0 });
      await expect(reader?.byteOccurrences?.("src/capped.bin", "00")).resolves.toMatchObject({ complete: false, matchCount: 201 });
      fs.writeFileSync(path.join(target, "src/stub.d.ts"), 'declare module "other-stub!!";\n');
      expect(() => reader?.ambientClassification?.("src/stub.d.ts")).toThrow(/stale-evidence/);
    } finally { reader?.dispose(); }
  }, 60_000
);

it.skipIf(!installedPackageRoot || !qualifiedArchivePath)(
  "uses authenticated large and raw test content while retaining binary context and mixed-range gaps",
  async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "lab-r3-fixture-gap-"));
    const target = path.join(root, "target");
    fs.mkdirSync(path.join(target, "tests", "fixtures"), { recursive: true });
    fs.writeFileSync(path.join(target, "package.json"), '{"name":"fixture-gap","type":"module"}');
    fs.writeFileSync(path.join(target, "README.md"), "Security validation is implemented in this project.\n");
    fs.mkdirSync(path.join(target, "src"));
    fs.writeFileSync(path.join(target, "src", "peer.mjs"), "export {};\n");
    fs.writeFileSync(path.join(target, "src", "orphan.mjs"), "export {};\n");
    fs.writeFileSync(path.join(target, "tests", "probe.test.mjs"),
      'test.only("independent", () => {});\nvoid import("../src/peer.mjs");\n');
    const commandFixture = "tests/fixtures/commands.json";
    fs.writeFileSync(path.join(target, commandFixture), JSON.stringify({ command: "npm run missing-command café" }) + "\r\n");
    const mixed = "tests/mixed.test.mjs";
    fs.writeFileSync(path.join(target, mixed), "// Mixed endings prevent reconstruction.\r\n// Second line.\n");
    const marker = "tests/fixtures/unreferenced-marker.txt";
    // Longer than its basename, so inventory size alone cannot establish absence.
    fs.writeFileSync(path.join(target, marker), Buffer.concat([Buffer.from("Controlled binary fixture "), Buffer.from([0, 255])]));
    const xml = "tests/fixtures/raw-source.xml";
    fs.writeFileSync(path.join(target, xml), '<fixture value="present.txt npm run missing-xml-command café"/>\r\n');
    fs.writeFileSync(path.join(target, "tests/fixtures/present.txt"), "Harmless fixture contents.\n");
    const largeJson = "tests/fixtures/large.json";
    fs.writeFileSync(path.join(target, largeJson), JSON.stringify({ value: "x".repeat(10000) + " npm run missing-json-command" }) + "\r\n");
    const longTest = "tests/long.test.mjs";
    fs.writeFileSync(path.join(target, longTest), "// padding\n".repeat(120) + 'test.only("whole content", () => {});\n');
    const out = path.join(root, "reports");
    const code = await runAuditCommandFromArgs([
      "--target", target, "--include", "docs,tests,package,architecture,cli", "--format", "text,json",
      "--fail-on", "none", "--out", out,
    ], { evidenceWorkspace: root, kitSourceProviderDependencies: {
      installedPackageRoot, qualifiedArchivePath, expectation: QUALIFIED_B3_P1_KIT,
      runCommand: async options => {
        if (options.args?.includes(mixed)) {
          expect(options.args).not.toContain("unreferenced-marker.txt");
          expect(options.args).not.toContain("--contains-bytes-hex");
        }
        if (options.args?.includes(commandFixture)) expect(options.args).not.toContain("npm run ");
        if (options.args?.includes(xml) || options.args?.includes(largeJson) || options.args?.includes(longTest)) {
          expect(options.args).not.toContain("--contains");
          expect(options.args).not.toContain("--contains-bytes-hex");
        }
        if (options.commandId.endsWith("-source-range")) {
          const receiptDir = options.cwd!;
          const commands = fs.readdirSync(receiptDir);
          expect(commands).toContain(options.commandId + "-initial.json");
          expect(commands).not.toContain(options.commandId + "-result.json");
          expect(commands).not.toContain(options.commandId + "-exit.json");
          expect(commands).not.toContain("outcome.json");
          const initial = JSON.parse(fs.readFileSync(path.join(receiptDir, "initial.json"), "utf8"));
          expect(initial.evidence.status).toBe("INCOMPLETE");
        }
        return runMeasuredCommand(options);
      },
    } });
    expect(code).toBe(2);
    const evidence = path.join(root, "lab-output", "evidence");
    const [id] = fs.readdirSync(evidence);
    const receipt = (name: string) => JSON.parse(fs.readFileSync(path.join(evidence, id!, name + ".json"), "utf8")).evidence;
    expect(receipt("initial").status).toBe("INCOMPLETE");
    const commands = fs.readdirSync(path.join(evidence, id!));
    expect(commands.some(name => name.endsWith("-source-range-result.json"))).toBe(true);
    expect(commands.some(name => name.endsWith("-byte-occurrence-initial.json"))).toBe(true);
    expect(receipt("audit-result").coverage).toContainEqual(expect.objectContaining({
      detectorId: "dead-code-candidate", predicate: "fixture literal absence unreferenced-marker.txt",
      source: { kind: "file", identity: "tests/probe.test.mjs" }, status: "QUALIFIED", mandatory: true,
      proof: expect.objectContaining({ kind: "authenticated-source-ranges" }),
    }));
    expect(receipt("kit-selection").inventory).toContainEqual(expect.objectContaining({
      path: marker, status: "unsupported", contentSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
    }));
    expect(receipt("audit-result").coverage).toContainEqual(expect.objectContaining({
      detectorId: "dead-code-candidate", predicate: "unreferenced-fixture " + marker,
      source: { kind: "file", identity: marker }, status: "QUALIFIED", mandatory: true,
      proof: expect.objectContaining({ kind: "exact-literal-byte" }),
    }));
    expect(receipt("audit-result").coverage).toContainEqual(expect.objectContaining({
      detectorId: "test-rot", predicate: "bounded-content predicates",
      source: { kind: "file", identity: marker }, status: "UNAVAILABLE", mandatory: true,
    }));
    expect(receipt("audit-result").coverage).toContainEqual(expect.objectContaining({
      detectorId: "dead-code-candidate", predicate: "unreferenced-fixture " + marker,
      source: { kind: "file", identity: mixed }, status: "UNAVAILABLE", mandatory: true,
    }));
    expect(receipt("audit-result").coverage).toContainEqual(expect.objectContaining({
      detectorId: "dead-code-candidate", predicate: "unreferenced-source-file",
      capability: "raw-content", status: "UNAVAILABLE", mandatory: true,
    }));
    const json = JSON.parse(fs.readFileSync(path.join(out, "code-rot-audit.json"), "utf8"));
    const issueIds = json.issues.map((issue: { id: string }) => issue.id);
    expect(issueIds).toContain("docs-code-mismatch:README.md:current-but-missing:security-validation");
    expect(issueIds).toContain("test-rot:tests/probe.test.mjs:only-usage:1");
    expect(issueIds).toContain("test-rot:tests/long.test.mjs:only-usage:121");
    expect(issueIds).toContain("test-rot:tests/fixtures/raw-source.xml:stale-npm-run-reference:missing-xml-command");
    expect(issueIds).toContain("test-rot:tests/fixtures/large.json:stale-npm-run-reference:missing-json-command");
    const coverage = receipt("audit-result").coverage;
    for (const file of [xml, largeJson]) {
      expect(coverage).toContainEqual(expect.objectContaining({
        detectorId: "dead-code-candidate", predicate: "fixture literal absence unreferenced-marker.txt",
        source: { kind: "file", identity: file }, status: "QUALIFIED",
        reason: expect.stringContaining("selected Kit file hash"),
        proof: expect.objectContaining({ kind: "exact-literal-byte" }),
      }));
    }
    expect(coverage).toContainEqual(expect.objectContaining({
      detectorId: "dead-code-candidate", predicate: "unreferenced-fixture tests/fixtures/present.txt",
      actualStatus: "positive-witness", status: "QUALIFIED",
    }));
    expect(coverage).not.toContainEqual(expect.objectContaining({
      detectorId: "test-rot", predicate: "bounded-content predicates",
      source: { kind: "file", identity: longTest }, status: "UNAVAILABLE",
    }));
    expect(json.issues).toContainEqual(expect.objectContaining({
      detectorId: "test-rot", title: expect.stringContaining("npm run missing-command"),
    }));
    expect(issueIds).not.toContain("dead-code-candidate:unreferenced-fixture:" + marker);
    expect(json.exit).toMatchObject({ code: 2, breached: false });
    expect(receipt("outcome").reports).toHaveLength(2);
    expect(fs.readFileSync(path.join(out, "code-rot-audit.txt"), "utf8")).toContain(json.exit.reason);
  },
);

it.skipIf(!installedPackageRoot || !qualifiedArchivePath)(
  "uses exact static-import and re-export witnesses without closing unresolved reverse-reference domains",
  async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "lab-r3-static-references-"));
    for (const hasCollision of [false, true]) {
      const workspace = path.join(root, hasCollision ? "collision" : "covered");
      const target = path.join(workspace, "target");
      fs.mkdirSync(path.join(target, "src", "a"), { recursive: true });
      fs.mkdirSync(path.join(target, "tests"));
      fs.writeFileSync(path.join(target, "package.json"), '{"name":"static-references","type":"module"}\n');
      fs.writeFileSync(path.join(target, "src/a/peer.mjs"), "export const peer = 1;\n");
      fs.writeFileSync(path.join(target, "src/forwarded.mjs"), "export const forwarded = 1;\n");
      if (hasCollision) {
        fs.mkdirSync(path.join(target, "src", "b"));
        fs.writeFileSync(path.join(target, "src/b/peer.mjs"), "export const peer = 2;\n");
      }
      const origin = "tests/probe.test.mjs";
      fs.writeFileSync(path.join(target, origin), [
        'import { peer } from "../src/a/peer.mjs";',
        'export { forwarded } from "../src/forwarded.mjs";',
        'import "unresolved-alias";',
        'void peer;',
      ].join("\n"));
      const code = await runAuditCommandFromArgs([
        "--target", target, "--include", "cli,tests", "--format", "text,json", "--fail-on", "none",
      ], { evidenceWorkspace: workspace, kitSourceProviderDependencies: {
        installedPackageRoot, qualifiedArchivePath, expectation: QUALIFIED_B3_P1_KIT,
      } });
      const evidence = path.join(workspace, "lab-output", "evidence");
      const [id] = fs.readdirSync(evidence);
      const run = path.join(evidence, id!);
      const result = JSON.parse(fs.readFileSync(path.join(run, "audit-result.json"), "utf8")).evidence;
      const rows = result.coverage.filter((row: { detectorId: string }) => row.detectorId === "dead-code-candidate");
      const positiveTargets = rows.filter((row: { proof?: { kind: string } }) => row.proof?.kind === "import-target")
        .map((row: { proof: { references: string[] } }) => row.proof.references[1]);
      expect(positiveTargets.sort()).toEqual(["src/a/peer.mjs", "src/forwarded.mjs"]);
      expect(rows.some((row: { source: { identity: string }; predicate: string; status: string }) =>
        row.source.identity === origin && row.predicate === "unreferenced-source-file" && row.status === "UNAVAILABLE")).toBe(hasCollision);
      expect(result.issues.some((issue: { id: string }) => issue.id.includes("unreferenced-source-file:src/a/peer.mjs"))).toBe(false);
      expect(result.issues.some((issue: { id: string }) => issue.id.includes("unreferenced-source-file:src/b/peer.mjs"))).toBe(false);
      expect(rows.filter((row: { predicate: string }) => row.predicate === "unreferenced-source-file blocked candidate")
        .map((row: { source: { identity: string } }) => row.source.identity)).toEqual(hasCollision ? ["src/b/peer.mjs"] : []);
      if (hasCollision) expect(rows).toContainEqual(expect.objectContaining({
        predicate: "unreferenced-source-file", source: { kind: "file", identity: origin },
        reason: expect.stringContaining('import "unresolved-alias"'),
      }));
      if (hasCollision) expect(code).toBe(2);
      const lookupIds = fs.readdirSync(run).filter(name => name.endsWith("-import-target-initial.json"))
        .map(name => JSON.parse(fs.readFileSync(path.join(run, name), "utf8")).evidence.args.at(-2));
      expect(new Set(lookupIds).size).toBe(2);
      expect(lookupIds).toHaveLength(2);
    }
  }, 60_000,
);

it.skipIf(!currentInstalledRoot || !currentArchive)(
  "keeps looking for an immediate import after an extension alternative points to the same candidate",
  async () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "lab-r3-import-witness-order-"));
    const target = path.join(workspace, "target");
    fs.mkdirSync(path.join(target, "src"), { recursive: true });
    fs.mkdirSync(path.join(target, "tests"));
    fs.writeFileSync(path.join(target, "package.json"), '{"name":"import-witness-order","type":"module"}\n');
    fs.writeFileSync(path.join(target, "src/peer.ts"), "export {};\n");
    fs.writeFileSync(path.join(target, "src/unrelated.ts"), "export {};\n");
    fs.writeFileSync(path.join(target, "tests/a-alternative.test.mjs"), 'import "../src/peer.js";\n');
    fs.writeFileSync(path.join(target, "tests/z-immediate.test.mjs"), 'import "../src/peer.ts";\n');

    const exit = await runAuditCommandFromArgs([
      "--target", target, "--types", "code-rot", "--include", "cli,tests", "--fail-on", "none",
    ], { evidenceWorkspace: workspace, kitSourceProviderDependencies: {
      installedPackageRoot: currentInstalledRoot, qualifiedArchivePath: currentArchive, expectation: QUALIFIED_B5_P1_R7A_KIT,
    } });
    const evidence = path.join(workspace, "lab-output", "evidence");
    const [id] = fs.readdirSync(evidence);
    const rows = JSON.parse(fs.readFileSync(path.join(evidence, id!, "audit-result.json"), "utf8")).evidence.coverage;
    const detectorId = "dead-code-candidate";
    const predicate = "unreferenced-source-file";
    expect(rows).toContainEqual(expect.objectContaining({
      detectorId, predicate: "selected module reference", source: { kind: "file", identity: "tests/z-immediate.test.mjs" },
      status: "QUALIFIED", proof: expect.objectContaining({ references: [expect.any(String), "src/peer.ts"] }),
    }));
    expect(rows).not.toContainEqual(expect.objectContaining({
      detectorId, predicate: predicate + " blocked candidate", source: { kind: "file", identity: "src/peer.ts" },
    }));
    expect(rows).toContainEqual(expect.objectContaining({
      detectorId, predicate: predicate + " blocked candidate", source: { kind: "file", identity: "src/unrelated.ts" },
    }));
    expect(rows).toContainEqual(expect.objectContaining({
      detectorId, predicate, source: { kind: "file", identity: "tests/a-alternative.test.mjs" }, mandatory: true,
      status: "UNAVAILABLE",
    }));
    expect(exit).toBe(2);
  }, 60_000,
);

for (const { label, root, archive, expectation, extra } of [
  { label: "ordinary exclusions", root: installedPackageRoot, archive: qualifiedArchivePath, expectation: QUALIFIED_B3_P1_KIT, extra: "" },
  { label: "ordinary exclusions alongside built-ins", root: currentInstalledRoot, archive: currentArchive, expectation: QUALIFIED_B5_P1_R7A_KIT, extra: 'import "node:fs";\n' },
]) it.skipIf(!root || !archive)(
  "allows reverse-reference absence with " + label,
  async () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "lab-r3-static-exclusion-"));
    const target = path.join(workspace, "target");
    fs.mkdirSync(path.join(target, "src"), { recursive: true });
    fs.mkdirSync(path.join(target, "tests"));
    fs.writeFileSync(path.join(target, "package.json"), '{"name":"static-exclusion","type":"module"}\n');
    fs.writeFileSync(path.join(target, "src/orphan.mjs"), "export const orphan = 1;\n");
    fs.writeFileSync(path.join(target, "tests/probe.test.mjs"), extra + 'import "../src/missing.mjs";\n');
    await runAuditCommandFromArgs([
      "--target", target, "--include", "cli,tests", "--format", "text,json", "--fail-on", "none",
    ], { evidenceWorkspace: workspace, kitSourceProviderDependencies: {
      installedPackageRoot: root, qualifiedArchivePath: archive, expectation,
    } });
    const evidence = path.join(workspace, "lab-output", "evidence");
    const [id] = fs.readdirSync(evidence);
    const result = JSON.parse(fs.readFileSync(path.join(evidence, id!, "audit-result.json"), "utf8")).evidence;
    expect(result.issues).toContainEqual(expect.objectContaining({ id: "dead-code-candidate:unreferenced-source-file:src/orphan.mjs" }));
    expect(result.coverage).toContainEqual(expect.objectContaining({
      detectorId: "dead-code-candidate", predicate: "selected module exclusion", actualStatus: "proven-missing",
      proof: expect.objectContaining({ kind: "import-target" }),
    }));
    expect(result.coverage).not.toContainEqual(expect.objectContaining({
      detectorId: "dead-code-candidate", predicate: "unreferenced-source-file", status: "UNAVAILABLE",
    }));
  }, 60_000,
);

it.skipIf(!installedPackageRoot || !qualifiedArchivePath)(
  "retains candidate-specific gaps for bounded, unknown and outside-root imports",
  async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "lab-r3-candidate-domains-"));
    const origin = "tests/probe.test.mjs";
    for (const [label, code] of [
      ["finite", 'void import(flag ? "../src/peer.mjs" : "../src/missing.mjs");'],
      ["unknown", 'void import(process.env.MODULE_NAME);'],
      ["outside", 'void import("../../outside.mjs");'],
    ]) {
      const workspace = path.join(root, label);
      const target = path.join(workspace, "target");
      fs.mkdirSync(path.join(target, "src"), { recursive: true });
      fs.mkdirSync(path.join(target, "tests"));
      fs.writeFileSync(path.join(target, "package.json"), '{"name":"candidate-domains","type":"module"}');
      fs.writeFileSync(path.join(target, "src/peer.mjs"), "export {};\n");
      fs.writeFileSync(path.join(target, "src/unrelated.mjs"), "export {};\n");
      fs.writeFileSync(path.join(target, origin), "declareFlag();\n" + code + "\n");
      const exit = await runAuditCommandFromArgs([
        "--target", target, "--types", "code-rot", "--include", "cli,tests", "--fail-on", "none",
      ], { evidenceWorkspace: workspace, kitSourceProviderDependencies: {
        installedPackageRoot, qualifiedArchivePath, expectation: QUALIFIED_B3_P1_KIT,
      } });
      const base = path.join(workspace, "lab-output", "evidence");
      const [id] = fs.readdirSync(base);
      const rows = JSON.parse(fs.readFileSync(path.join(base, id!, "audit-result.json"), "utf8")).evidence.coverage;
      const detectorId = "dead-code-candidate";
      const predicate = "unreferenced-source-file";
      expect(exit).toBe(2);
      expect(rows).toContainEqual(expect.objectContaining({
        detectorId, predicate, source: { kind: "file", identity: origin }, mandatory: true, status: "UNAVAILABLE",
      }));
      expect(rows).toContainEqual(expect.objectContaining({
        detectorId, predicate: predicate + " blocked candidate", source: { kind: "file", identity: "src/peer.mjs" },
      }));
      expect(rows).toContainEqual(expect.objectContaining({
        detectorId, predicate: predicate + (label === "finite" ? " candidate exclusion" : " blocked candidate"),
        source: { kind: "file", identity: "src/unrelated.mjs" },
      }));
    }
  }, 60_000,
);

it.skipIf(!installedPackageRoot || !qualifiedArchivePath)(
  "qualifies package roots and explicit Node built-ins while rejecting ESM extension substitution",
  async () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "lab-r3-package-roots-"));
    const target = path.join(workspace, "target");
    fs.mkdirSync(path.join(target, "src"), { recursive: true });
    fs.mkdirSync(path.join(target, "tests"));
    fs.writeFileSync(path.join(target, "package.json"), JSON.stringify({
      name: "candidate-roots", type: "module",
      scripts: { dev: "tsx src/cli.ts", build: "tsup" }, devDependencies: { tsup: "^8.5.1" },
    }));
    for (const candidate of ["src/cli.ts", "src/esm-only.ts", "tsup.config.ts"]) {
      fs.writeFileSync(path.join(target, candidate), "export {};\n");
    }
    fs.writeFileSync(path.join(target, "tests/probe.test.mjs"), 'export * from "../src/esm-only.js";\n');
    fs.writeFileSync(path.join(target, "tests/builtin.test.mjs"), 'import "node:fs";\n');
    const exit = await runAuditCommandFromArgs([
      "--target", target, "--types", "code-rot", "--include", "cli,package,tests", "--fail-on", "none",
    ], { evidenceWorkspace: workspace, kitSourceProviderDependencies: {
      installedPackageRoot, qualifiedArchivePath, expectation: QUALIFIED_B3_P1_KIT,
    } });
    const base = path.join(workspace, "lab-output", "evidence");
    const [id] = fs.readdirSync(base);
    const rows = JSON.parse(fs.readFileSync(path.join(base, id!, "audit-result.json"), "utf8")).evidence.coverage;
    const detectorId = "dead-code-candidate";
    const predicate = "unreferenced-source-file";
    expect(exit).toBe(2);
    for (const candidate of ["src/cli.ts", "tsup.config.ts"]) expect(rows).toContainEqual(expect.objectContaining({
      detectorId, predicate: "selected package script root", source: { kind: "file", identity: candidate }, status: "QUALIFIED",
    }));
    expect(rows).toContainEqual(expect.objectContaining({
      detectorId, predicate: predicate + " blocked candidate", source: { kind: "file", identity: "src/esm-only.ts" },
    }));
    expect(rows).toContainEqual(expect.objectContaining({
      detectorId, predicate, source: { kind: "file", identity: "tests/builtin.test.mjs" }, mandatory: false, status: "QUALIFIED",
    }));
    expect(rows).toContainEqual(expect.objectContaining({
      detectorId, predicate, source: { kind: "file", identity: "tests/probe.test.mjs" }, mandatory: true, status: "UNAVAILABLE",
      reason: expect.stringContaining("TARGET_IN_SELECTED_INVENTORY"),
    }));
  }, 60_000,
);

const ordinaryProfile = "js-ts-selected-source-reference-v1";

function ordinaryContractFixture(
  target: string, workDir: string,
  contracts: Record<string, { domain: string[]; reference?: string }>,
  qualified: boolean,
) {
  const calls: string[] = [];
  const digest = (value: Buffer | string) => createHash("sha256").update(value).digest("hex");
  const deps: KitSourceProviderDependencies = {
    installedPackageRoot: path.resolve("node_modules/@dailephd/my-dev-kit"),
    expectation: QUALIFIED_CURRENT_PUBLISHED_KIT,
    workDir, disableStream: true,
    testOnlyOrdinarySourceReference: qualified ? true : undefined,
    runCommand: async options => {
      const result = await runMeasuredCommand(options);
      const args = options.args ?? [];
      const selector = args.indexOf("--audit-import-target");
      if (!result.ok || selector < 0) return result;
      const parent = JSON.parse(result.stdout);
      calls.push(parent.importFactId);
      const rule = contracts[parent.sourceSpecifier];
      if (!rule) return result;
      const artifact = JSON.parse(fs.readFileSync(path.join(args[args.indexOf("--index") + 1]!, "source-audit-evidence.json"), "utf8"));
      const selected = new Map<string, string | null>(artifact.files.map((file: { path: string; contentSha256: string | null }) =>
        [file.path, file.contentSha256]));
      const refs = rule.domain.map(file => ({
        role: "candidate", path: file, state: selected.has(file) ? "file" : "absent",
        contentSha256: selected.get(file) ?? null,
      }));
      refs.push({ role: "config", path: "tsconfig.json", state: "file", contentSha256: digest(fs.readFileSync(path.join(target, "tsconfig.json"))) });
      refs.push({ role: "package-metadata", path: "package.json", state: "file", contentSha256: digest(fs.readFileSync(path.join(target, "package.json"))) });
      refs.push({ role: "path", path: "alternate-config", state: "absent", contentSha256: null });
      const sourceReferenceProof = {
        schemaVersion: "1.0.0", profile: ordinaryProfile, pathIdentityProfile: "selected-source-path-v1",
        snapshotId: parent.snapshotId, selectionFingerprint: artifact.source.selectionFingerprint,
        selectedDomainDigest: digest(JSON.stringify([...selected.keys()].sort())),
        originFile: parent.originFile, originContentSha256: selected.get(parent.originFile),
        importFactId: parent.importFactId, sourceSpecifier: parent.sourceSpecifier,
        resolutionPlatform: process.platform === "win32" ? "win32" : "posix",
        candidateEnumerationComplete: true, candidateDomain: rule.domain,
        qualifiedReference: rule.reference ? { targetPath: rule.reference, targetContentSha256: selected.get(rule.reference),
          referenceKind: "selected-source-reference" } : null,
        premiseRefs: refs,
        reasonCode: null,
      };
      return { ...result, stdout: JSON.stringify({ ...parent, sourceReferenceProof, exactSelectedPath: "src/decoy.ts",
        selectedTargetUpperBound: ["src/decoy.ts"], qualifiedSourceReferencePath: "src/decoy.ts" }) };
    },
  };
  return { deps, calls };
}

it.each([true, false])("gates ordinary source-reference semantics on fixture qualification (%s)", async qualified => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "lab-f02-ordinary-reader-"));
  try {
    const target = path.join(workspace, "target");
    fs.mkdirSync(path.join(target, "src"), { recursive: true });
    fs.writeFileSync(path.join(target, "package.json"), '{"name":"ordinary-reader"}');
    fs.writeFileSync(path.join(target, "tsconfig.json"), '{"compilerOptions":{}}');
    fs.writeFileSync(path.join(target, "src/entry.ts"), 'export { peer } from "./peer.js";\n');
    fs.writeFileSync(path.join(target, "src/peer.ts"), "export const peer = 1;\n");
    const workDir = path.join(workspace, "kit");
    const fixture = ordinaryContractFixture(target, workDir, {
      "./peer.js": { domain: ["src/peer.js", "src/peer.ts", "src/peer.tsx"], reference: "src/peer.ts" },
    }, qualified);
    let reader: KitSourceReader | undefined;
    await collectKitSourceFacts({
      targetRoot: target, inventory: scanProjectInventory(target), requiredPaths: ["src/entry.ts", "src/peer.ts"],
      requiredCapabilities: [], includeScriptsRoot: false, onReader: value => { reader = value; },
    }, fixture.deps);
    try {
      const [edge] = reader!.reExportTargets?.("src/entry.ts") ?? [];
      expect(edge).toMatchObject({ sourceSpecifier: "./peer.js" });
      const read = () => reader!.importTarget(edge!.id);
      const first = await read();
      expect(first.exactSelectedPath).toBeUndefined();
      expect(first.qualifiedSourceReferencePath).toBe(qualified ? "src/peer.ts" : undefined);
      expect(first.selectedTargetUpperBound).toEqual(qualified ? ["src/peer.ts"] : undefined);
      if (!qualified) return;
      for (const [name, change] of [
        ["tsconfig.json", '{"compilerOptions":{"rootDirs":["src"]}}'],
        ["package.json", '{"name":"changed"}'],
        ["src/peer.tsx", "export {};"],
        ["src/peer.ts", "export const peer = 0;\n"],
      ]) {
        const file = path.join(target, name!);
        const original = fs.existsSync(file) ? fs.readFileSync(file) : null;
        fs.writeFileSync(file, change!);
        try { await expect(read()).rejects.toMatchObject({ category: "stale-evidence" }); }
        finally { if (original) fs.writeFileSync(file, original); else fs.unlinkSync(file); }
      }
      const outside = path.join(workspace, "outside");
      fs.mkdirSync(outside);
      fs.symlinkSync(outside, path.join(target, "alternate-config"), "junction");
      await expect(read()).rejects.toMatchObject({ category: "stale-evidence" });
      expect(fixture.calls).toEqual([edge!.id]);
    } finally { await reader?.dispose(); }
  } finally { fs.rmSync(workspace, { recursive: true, force: true }); }
}, 60_000);


it.each([
  { unknown: false, threshold: "none" },
  { unknown: true, threshold: "none" },
  { unknown: true, threshold: "blocker" },
  { unknown: "other-origin", threshold: "none" },
])("combines ordinary, re-export and computed bounds while retaining positives (%j)", async ({ unknown, threshold }) => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "lab-f02-ordinary-audit-"));
  try {
    const target = path.join(workspace, "target");
    fs.mkdirSync(path.join(target, "src"), { recursive: true });
    fs.mkdirSync(path.join(target, "tests"));
    fs.writeFileSync(path.join(target, "package.json"), '{"name":"ordinary-union","type":"module"}');
    fs.writeFileSync(path.join(target, "tsconfig.json"), '{"compilerOptions":{}}');
    for (const name of ["peer.ts", "choice.ts", "choice.tsx", "float.mjs", "other.ts"]) {
      fs.writeFileSync(path.join(target, "src", name), "export const witness = 1;\n");
    }
    fs.writeFileSync(path.join(target, "src/main.ts"), [
      ...(unknown === true ? ['import "unresolved-alias";'] : []),
      'import "./peer.js";',
      'export * from "./choice.js";',
      'void import(process.env.PROFILE ? "./float.mjs" : "./nowhere.mjs");',
    ].join("\n"));
    fs.writeFileSync(path.join(target, "tests/probe.test.mjs"), 'test.only("independent", () => {});\n');
    if (unknown === "other-origin") fs.writeFileSync(path.join(target, "tests/unknown.test.mjs"), 'export * from "unresolved-alias";');
    // Unlike the configured ordinary edge, this independent ESM operand is
    // intentionally finite but lacks a complete destination profile with tsconfig present.
    // Supply an independent computed wire control below for the unchanged domain reader.
    const workDir = path.join(workspace, "kit");
    const fixture = ordinaryContractFixture(target, workDir, {
      "./peer.js": { domain: ["src/peer.js", "src/peer.ts", "src/peer.tsx"], reference: "src/peer.ts" },
      "./choice.js": { domain: ["src/choice.js", "src/choice.ts", "src/choice.tsx"] },
    }, true);
    const runFixture = fixture.deps.runCommand!;
    fixture.deps.runCommand = async options => {
      const result = await runFixture(options);
      if (!result.ok || !options.args?.includes("--audit-import-domain")) return result;
      const raw = JSON.parse(result.stdout);
      if (raw.originFile !== "src/main.ts") return result;
      for (const alternative of raw.operandAlternatives) {
        const selected = alternative.specifier === "./float.mjs";
        alternative.resolution = {
          status: selected ? "present" : "proven-missing",
          reasonCode: selected ? "TARGET_IN_SELECTED_INVENTORY" : "ALL_CANDIDATES_ABSENT_IN_COMPLETE_SELECTION",
          selectionComplete: true, candidateEnumerationComplete: true,
          candidatePaths: selected ? ["src/float.mjs", "src/float.mts"] : ["src/nowhere.mjs", "src/nowhere.mts"],
        };
      }
      return { ...result, stdout: JSON.stringify(raw) };
    };
    const code = await runAuditCommandFromArgs([
      "--target", target, "--types", "code-rot", "--include", "architecture,tests", "--fail-on", threshold,
      "--format", "json", "--out", path.join(workspace, "reports"),
    ], { evidenceWorkspace: workspace, kitSourceProviderDependencies: fixture.deps });
    const evidence = path.join(workspace, "lab-output/evidence");
    const [id] = fs.readdirSync(evidence);
    const result = JSON.parse(fs.readFileSync(path.join(evidence, id!, "audit-result.json"), "utf8")).evidence;
    const blocked = result.coverage.filter((entry: { predicate: string }) => entry.predicate === "unreferenced-source-file blocked candidate")
      .map((entry: { source: { identity: string } }) => entry.source.identity);
    expect(code).toBe(2);
    expect(result.issues.some((issue: { id: string }) => issue.id.includes("only"))).toBe(true);
    expect(result.coverage).toContainEqual(expect.objectContaining({
      predicate: "selected module reference", proof: expect.objectContaining({ references: [expect.any(String), "src/peer.ts"] }),
    }));
    expect(blocked).toEqual(expect.arrayContaining(["src/choice.ts", "src/choice.tsx", "src/float.mjs"]));
    expect(blocked).not.toContain("src/peer.ts");
    if (unknown) expect(blocked).toContain("src/other.ts");
    else {
      expect(blocked).not.toContain("src/other.ts");
      expect(result.issues).toContainEqual(expect.objectContaining({ id: "dead-code-candidate:unreferenced-source-file:src/other.ts" }));
    }
    expect(new Set(fixture.calls).size).toBe(fixture.calls.length);
  } finally { fs.rmSync(workspace, { recursive: true, force: true }); }
}, 90_000);

function computedReferenceFixture(target: string, workDir: string, expression: boolean, ordinary = false) {
  const fixture = ordinaryContractFixture(target, workDir, {}, ordinary);
  const runLegacy = fixture.deps.runCommand!;
  const queries: string[] = [];
  fixture.deps.testOnlyExpressionReference = expression ? true : undefined;
  fixture.deps.runCommand = async options => {
    const result = await runLegacy(options);
    if (!result.ok || !options.args?.includes("--audit-import-domain")) return result;
    const parent = JSON.parse(result.stdout);
    if (parent.originFile !== "src/entry.mjs") return result;
    queries.push(parent.importExpressionFactId);
    const targetPath = "src/peer.mjs";
    const targetContentSha256 = createHash("sha256").update(fs.readFileSync(path.join(target, targetPath))).digest("hex");
    const expressionReferenceProof = {
      schemaVersion: "1.0.0", profile: "js-ts-computed-exact-source-reference-v1",
      expressionFactId: parent.importExpressionFactId, alternativeIndex: 0,
      specifier: "./peer.mjs", targetPath, targetContentSha256, premiseIndexes: [0, 1],
      resolutionPremiseRefs: [
        { role: "candidate", path: targetPath, state: "file", contentSha256: targetContentSha256 },
        { role: "candidate", path: "src/peer.mts", state: "absent", contentSha256: null },
        ...["jsconfig.json", "src/jsconfig.json", "src/tsconfig.json", "tsconfig.json"].map(filePath =>
          ({ role: "config", path: filePath, state: "absent", contentSha256: null })),
      ],
    };
    return { ...result, stdout: JSON.stringify({ ...parent, expressionReferenceProof }) };
  };
  return { deps: fixture.deps, queries };
}

it.each([true, false])("qualifies only the separate expression capability and rechecks cached premises (%s)", async expression => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "lab-f02-expression-reader-"));
  let reader: KitSourceReader | undefined;
  try {
    const target = path.join(workspace, "target");
    fs.mkdirSync(path.join(target, "src"), { recursive: true });
    const entry = 'const exact = "./peer.mjs";\nvoid import(exact);\n';
    fs.writeFileSync(path.join(target, "package.json"), '{"name":"expression-reader","type":"module"}');
    fs.writeFileSync(path.join(target, "src/entry.mjs"), entry);
    fs.writeFileSync(path.join(target, "src/peer.mjs"), "export {};\n");
    const fixture = computedReferenceFixture(target, path.join(workspace, "kit"), expression, true);
    await collectKitSourceFacts({
      targetRoot: target, inventory: scanProjectInventory(target), requiredPaths: ["src/entry.mjs", "src/peer.mjs"],
      requiredCapabilities: [], includeScriptsRoot: false, onReader: value => { reader = value; },
    }, fixture.deps);
    expect(reader!.ordinarySourceReference).toBe(true);
    const read = () => reader!.expressionDomains!("src/entry.mjs");
    const [domain] = await read();
    expect(domain!.linkedImportFactId).toBeUndefined();
    expect(domain!.proof.expressionFactId).toBe("audit-fact:src%2Fentry.mjs#dynamic-import-expression#2#5#0");
    expect(domain!.proof.positivePaths).toEqual(expression ? ["src/peer.mjs"] : []);
    expect(domain!.proof.selectedTargetUpperBound).toEqual(["src/peer.mjs"]);
    expect(domain!.proof).not.toHaveProperty("expressionReferencePremises");
    if (!expression) return;
    for (const [name, change] of [
      ["tsconfig.json", '{"compilerOptions":{}}'],
      ["src/jsconfig.json", '{"compilerOptions":{}}'],
      ["src/peer.mts", "export {};"],
      ["src/peer.mjs", "export const changed = 1;\n"],
      ["src/entry.mjs", entry + "// changed\n"],
    ]) {
      const file = path.join(target, name!);
      const original = fs.existsSync(file) ? fs.readFileSync(file) : null;
      fs.writeFileSync(file, change!);
      try { await expect(read()).rejects.toMatchObject({ category: "stale-evidence" }); }
      finally { if (original) fs.writeFileSync(file, original); else fs.unlinkSync(file); }
    }
    expect(fixture.queries).toEqual([domain!.proof.expressionFactId]);
  } finally {
    await reader?.dispose();
    fs.rmSync(workspace, { recursive: true, force: true });
  }
}, 60_000);

it.each(["none", "blocker"])("discharges an expression target while an unknown origin keeps a mandatory gap (%s)", async threshold => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "lab-f02-expression-audit-"));
  try {
    const target = path.join(workspace, "target");
    fs.mkdirSync(path.join(target, "src"), { recursive: true });
    fs.mkdirSync(path.join(target, "tests"));
    fs.writeFileSync(path.join(target, "package.json"), '{"name":"expression-discharge","type":"module"}');
    fs.writeFileSync(path.join(target, "src/entry.mjs"), 'const exact = "./peer.mjs";\nvoid import(exact);\n');
    fs.writeFileSync(path.join(target, "src/peer.mjs"), "export const peer = 1;\n");
    fs.writeFileSync(path.join(target, "src/unrelated.mjs"), "export const unrelated = 1;\n");
    fs.writeFileSync(path.join(target, "src/unknown.mjs"), "void import(process.env.DESTINATION);\n");
    fs.writeFileSync(path.join(target, "tests/probe.test.mjs"), 'test.only("independent", () => {});\n');
    const fixture = computedReferenceFixture(target, path.join(workspace, "kit"), true);
    const code = await runAuditCommandFromArgs([
      "--target", target, "--types", "code-rot", "--include", "architecture,tests", "--fail-on", threshold,
      "--format", "json", "--out", path.join(workspace, "reports"),
    ], { evidenceWorkspace: workspace, kitSourceProviderDependencies: fixture.deps });
    const receipts = path.join(workspace, "lab-output/evidence");
    const [id] = fs.readdirSync(receipts);
    const result = JSON.parse(fs.readFileSync(path.join(receipts, id!, "audit-result.json"), "utf8")).evidence;
    expect(code).toBe(2);
    expect(result.issues.some((issue: { id: string }) => issue.id.includes("only"))).toBe(true);
    const blocked = result.coverage.filter((row: { predicate: string }) => row.predicate === "unreferenced-source-file blocked candidate")
      .map((row: { source: { identity: string } }) => row.source.identity);
    expect(blocked).toContain("src/unrelated.mjs");
    expect(blocked).not.toContain("src/peer.mjs");
    expect(result.coverage).toContainEqual(expect.objectContaining({
      predicate: "unreferenced-source-file", source: { kind: "file", identity: "src/unknown.mjs" }, mandatory: true,
    }));
    expect(result.issues).not.toContainEqual(expect.objectContaining({ id: "dead-code-candidate:unreferenced-source-file:src/peer.mjs" }));
    expect(fixture.queries).toEqual(["audit-fact:src%2Fentry.mjs#dynamic-import-expression#2#5#0"]);
  } finally { fs.rmSync(workspace, { recursive: true, force: true }); }
}, 90_000);
