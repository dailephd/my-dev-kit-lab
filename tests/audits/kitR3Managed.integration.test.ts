import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { runAuditCommandFromArgs } from "../../src/commands/runAuditCommand.js";
import { runMeasuredCommand } from "../../src/core/runMeasuredCommand.js";
import { scanProjectInventory } from "../../src/audits/core/projectInventory.js";
import { collectKitSourceFacts, type KitSourceReader, QUALIFIED_B3_P1_KIT } from "../../src/audits/core/kitSourceProvider.js";

const installedPackageRoot = process.env.LAB_R3_INSTALLED_KIT;
const qualifiedArchivePath = process.env.LAB_R3_KIT_ARCHIVE;
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
      const out = path.join(root, threshold);
      const workDir = path.join(root, "kit-" + threshold);
      const code = await runAuditCommandFromArgs([
        "--target", target, "--types", "code-rot", "--include", "tests",
        "--fail-on", threshold, "--format", "text,json", "--out", out,
      ], { kitSourceProviderDependencies: { installedPackageRoot, qualifiedArchivePath, expectation: QUALIFIED_B3_P1_KIT, workDir } });
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
        const dir = path.join(workDir, "logs");
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
    fs.writeFileSync(path.join(target, rustPath), malformed);
    const extendedRequest = {
      ...request, inventory: scanProjectInventory(target),
      requiredPaths: [...request.requiredPaths, jsonPath, clippedPath, binaryPath, rustPath],
    };
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
  "retains reports and independent findings when a selected text fixture has no qualified raw-content reader",
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
    fs.writeFileSync(path.join(target, marker), "Controlled unsupported text fixture.\n");
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
    expect(commands.some(name => name.endsWith("-byte-occurrence-initial.json"))).toBe(false);
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
    expect(json.issues).toContainEqual(expect.objectContaining({
      detectorId: "test-rot", title: expect.stringContaining("npm run missing-command"),
    }));
    expect(issueIds).not.toContain("dead-code-candidate:unreferenced-fixture:" + marker);
    expect(json.exit).toMatchObject({ code: 2, breached: false });
    expect(receipt("outcome").reports).toHaveLength(2);
    expect(fs.readFileSync(path.join(out, "code-rot-audit.txt"), "utf8")).toContain(json.exit.reason);
  },
);
