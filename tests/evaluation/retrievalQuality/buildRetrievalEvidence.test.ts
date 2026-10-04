import { describe, expect, it } from "vitest";
import { normalizeRepositoryRelativePath } from "../../../src/experiments/plugins/contextWindowScaling/relevantFiles.js";
import {
  buildRetrievalEvidence,
  buildRetrievalEvidenceFromCommands,
  normalizeRetrievedRepositoryPath,
  type RetrievalEvidenceCommandInput
} from "../../../src/evaluation/retrievalQuality/index.js";

type Entry = Record<string, unknown>;

const fileNode = (path: string, extra: Entry = {}): Entry => ({ id: `file:${path}`, kind: "file", label: path.split("/").pop(), path, ...extra });
const symbolNode = (path: string, name: string, extra: Entry = {}): Entry => ({
  id: `symbol:${path}#${name}`,
  kind: "symbol",
  label: name,
  path,
  symbolName: name,
  ...extra
});
// Search results name the node id `nodeId` and the symbol name `label`.
const searchHit = (node: Entry): Entry => ({ ...node, nodeId: node.id, score: 1, matchReasons: [] });

const searchOut = (results: unknown[]):RetrievalEvidenceCommandInput => ({
  family: "search",
  ok: true,
  stdout: JSON.stringify({ artifactKind: "my-dev-kit-v1-search-result", version: "1.0.0", results })
});
const lookupOut = (node: Entry, neighbors: Entry[] = []): RetrievalEvidenceCommandInput => ({
  family: "lookup",
  ok: true,
  stdout: JSON.stringify({ status: "found", node, neighbors, incomingEdges: [], outgoingEdges: [] })
});
const sliceOut = (nodes: Entry[]): RetrievalEvidenceCommandInput => ({
  family: "slice",
  ok: true,
  stdout: JSON.stringify({ artifactKind: "my-dev-kit-v1-graph-slice", version: "1.0.0", nodes, edges: [] })
});
const sourceOk: RetrievalEvidenceCommandInput = { family: "source", ok: true };

const runA = symbolNode("src/a.ts", "run");
const runB = symbolNode("src/b.ts", "run");

describe("buildRetrievalEvidence", () => {
  it("TST-B1-001 unions, deduplicates and orders files regardless of command input order", () => {
    const commands = [
      sourceOk,
      sliceOut([fileNode("src/b.ts"), fileNode("src/a.ts")]),
      lookupOut(runB, [fileNode("src\\a.ts"), symbolNode("src/c.ts", "helper")]),
      searchOut([searchHit(fileNode("./src/a.ts")), searchHit(runB)])
    ];
    const evidence = buildRetrievalEvidence({ commands, selection: { nodeId: runB.id as string, file: "src/b.ts" } });
    expect(evidence.files.map((file) => file.path)).toEqual(["src/a.ts", "src/b.ts", "src/c.ts"]);
    expect(evidence.availability).toBe("available");
  });

  it("TST-B1-002 keeps distinct symbols that share a display name and orders them by file, name, node id", () => {
    const evidence = buildRetrievalEvidence({ commands: [searchOut([searchHit(runB), searchHit(runA)])] });
    expect(evidence.symbols).toEqual([
      { name: "run", nodeId: "symbol:src/a.ts#run", file: "src/a.ts", surfacedBy: ["search"] },
      { name: "run", nodeId: "symbol:src/b.ts#run", file: "src/b.ts", surfacedBy: ["search"] }
    ]);
  });

  it("TST-B1-002 does not invent a node id or file when upstream omits them", () => {
    const evidence = buildRetrievalEvidence({
      commands: [searchOut([{ kind: "symbol", label: "orphan", score: 1 }]), lookupOut({ kind: "symbol", symbolName: "orphan" })]
    });
    expect(evidence.symbols).toEqual([{ name: "orphan", surfacedBy: ["search", "lookup"] }]);
    expect(evidence.files).toEqual([]);
  });

  it("TST-B1-003 records every surfacing family in lifecycle order", () => {
    const evidence = buildRetrievalEvidence({
      commands: [sliceOut([runA]), sourceOk, searchOut([searchHit(runA)]), lookupOut(runA)],
      selection: { nodeId: runA.id as string, file: "src/a.ts" }
    });
    expect(evidence.commands.map((command) => command.family)).toEqual(["search", "lookup", "slice", "source"]);
    expect(evidence.symbols[0].surfacedBy).toEqual(["search", "lookup", "slice", "source"]);
    expect(evidence.files).toEqual([{ path: "src/a.ts", surfacedBy: ["search", "lookup", "slice", "source"] }]);
  });

  it("TST-B1-004 distinguishes a successful empty retrieval from unavailable evidence", () => {
    const empty = buildRetrievalEvidence({ commands: [searchOut([])] });
    expect(empty).toMatchObject({ availability: "available", files: [], symbols: [] });
    expect(empty.commands).toEqual([
      { family: "search", succeeded: true, parseState: "parsed", fileEvidenceCount: 0, symbolEvidenceCount: 0, rejectedIdentityCount: 0 }
    ]);

    const unavailable: Array<[string, RetrievalEvidenceCommandInput[]]> = [
      ["no commands", []],
      ["search not executed", [lookupOut(runA)]],
      ["search failed", [{ family: "search", ok: false, stdout: "" }]],
      ["search not JSON", [{ family: "search", ok: true, stdout: "not json" }]],
      ["legacy search shape", [{ family: "search", ok: true, stdout: JSON.stringify({ results: [{ nodeId: "x", file: "src/a.ts", symbol: "x" }] }) }]],
      ["unsupported search major version", [{ family: "search", ok: true, stdout: JSON.stringify({ artifactKind: "my-dev-kit-v1-search-result", version: "2.0.0", results: [] }) }]]
    ];
    for (const [label, commands] of unavailable) {
      const evidence = buildRetrievalEvidence({ commands });
      expect(evidence.availability, label).toBe("unavailable");
      expect(evidence.availabilityReason, label).toEqual(expect.any(String));
    }
    // Unavailable is a flag, not a rewrite: identities that a command explicitly surfaced are still recorded.
    expect(buildRetrievalEvidence({ commands: [lookupOut(runA)] }).files.map((file) => file.path)).toEqual(["src/a.ts"]);
    expect(buildRetrievalEvidence({ commands: [{ family: "search", ok: false, stdout: "" }] }).files).toEqual([]);
  });

  it("TST-B1-005 marks malformed or unsupported follow-up output partial with a bounded reason and keeps valid evidence", () => {
    const cases: Array<[string, RetrievalEvidenceCommandInput, string, string]> = [
      ["lookup not JSON", { family: "lookup", ok: true, stdout: "Node not found: file:x" }, "malformed", "output-is-not-json"],
      ["lookup legacy shape", { family: "lookup", ok: true, stdout: JSON.stringify({ nodeId: "x", summary: "s" }) }, "unsupported-schema", "output-is-not-the-supported-upstream-schema"],
      ["lookup status not found", { family: "lookup", ok: true, stdout: JSON.stringify({ status: "not-found", node: {}, neighbors: [] }) }, "unsupported-schema", "output-is-not-the-supported-upstream-schema"],
      ["slice wrong artifact", { family: "slice", ok: true, stdout: JSON.stringify({ artifactKind: "other", version: "1.0.0", nodes: [] }) }, "unsupported-schema", "output-is-not-the-supported-upstream-schema"],
      ["slice JSON array", { family: "slice", ok: true, stdout: "[]" }, "unsupported-schema", "output-is-not-the-supported-upstream-schema"]
    ];
    for (const [label, command, parseState, reason] of cases) {
      const evidence = buildRetrievalEvidence({ commands: [searchOut([searchHit(runA)]), command] });
      expect(evidence.availability, label).toBe("partial");
      expect(evidence.files.map((file) => file.path), label).toEqual(["src/a.ts"]);
      expect(evidence.commands[1], label).toMatchObject({ parseState, reason, fileEvidenceCount: 0, symbolEvidenceCount: 0 });
    }
  });

  it("TST-B1-005 rejects invalid node entries instead of guessing them", () => {
    const evidence = buildRetrievalEvidence({
      commands: [searchOut([searchHit(runA), { kind: "file" }, { kind: "symbol", path: "src/x.ts" }, "string-entry", { id: "x" }])]
    });
    expect(evidence.availability).toBe("partial");
    expect(evidence.commands[0]).toMatchObject({ rejectedIdentityCount: 4, reason: "unsafe-or-invalid-identity-rejected" });
    expect(evidence.symbols.map((symbol) => symbol.name)).toEqual(["run"]);
  });

  it("TST-B1-006 keeps failed commands distinct from successful commands that returned nothing", () => {
    const base = [searchOut([searchHit(runA)])];
    const failures: Array<[RetrievalEvidenceCommandInput, string]> = [
      [{ family: "lookup", ok: false, stdout: "boom" }, "lookup"],
      [{ family: "slice", ok: false, stdout: "boom" }, "slice"],
      [{ family: "source", ok: false }, "source"]
    ];
    for (const [command, family] of failures) {
      const evidence = buildRetrievalEvidence({ commands: [...base, command], selection: { file: "src/a.ts" } });
      expect(evidence.availability, family).toBe("partial");
      expect(evidence.commands.find((entry) => entry.family === family), family).toMatchObject({ succeeded: false, parseState: "command-failed", reason: "command-failed" });
    }
    const emptyButSuccessful = buildRetrievalEvidence({ commands: [...base, lookupOut(runA, []), sliceOut([]), sourceOk], selection: { file: "src/a.ts" } });
    expect(emptyButSuccessful.availability).toBe("available");
    expect(emptyButSuccessful.commands.map((entry) => entry.succeeded)).toEqual([true, true, true, true]);
  });

  it("TST-B1-006 treats a repeated command family as partial evidence", () => {
    const evidence = buildRetrievalEvidence({ commands: [searchOut([searchHit(runA)]), searchOut([searchHit(runB)])] });
    expect(evidence.availability).toBe("partial");
    expect(evidence.symbols.map((symbol) => symbol.file)).toEqual(["src/a.ts"]);
  });

  it("TST-B1-007 rejects unsafe repository identities without echoing or repairing them", () => {
    const unsafe = [
      "/etc/passwd-secret",
      "C:\\Users\\someone\\secret.ts",
      "c:/secret.ts",
      "\\\\server\\share\\secret.ts",
      "../secret.ts",
      "src/../../secret.ts",
      "src//secret.ts",
      "src/secret.ts/",
      "",
      "src/sec\0ret.ts",
      "x".repeat(1100)
    ];
    for (const value of unsafe) {
      const evidence = buildRetrievalEvidence({
        commands: [searchOut([searchHit(fileNode(value, { id: "file:safe" })), searchHit(symbolNode(value, "sym"))])]
      });
      expect(evidence.files, JSON.stringify(value.slice(0, 20))).toEqual([]);
      expect(evidence.symbols).toEqual([]);
      expect(evidence.availability).toBe("partial");
      expect(evidence.commands[0].rejectedIdentityCount).toBe(2);
      expect(JSON.stringify(evidence)).not.toContain("secret");
    }
    const sourceUnsafe = buildRetrievalEvidence({
      commands: [searchOut([]), sourceOk],
      selection: { file: "/abs/secret.ts" }
    });
    expect(sourceUnsafe.availability).toBe("partial");
    expect(sourceUnsafe.files).toEqual([]);
    expect(sourceUnsafe.commands[1]).toMatchObject({ parseState: "unattributable", rejectedIdentityCount: 1 });
    expect(JSON.stringify(sourceUnsafe)).not.toContain("secret");
  });

  it("TST-B1-008 never reads identities out of source output or embedded strings", () => {
    const evidence = buildRetrievalEvidenceFromCommands(
      [
        { commandId: "search", ok: true, stdout: JSON.stringify({ artifactKind: "my-dev-kit-v1-search-result", version: "1.0.0", results: [searchHit(runA)] }) },
        {
          commandId: "source",
          ok: true,
          stdout: "1 import x from 'src/evil.ts'; // symbol:src/evil.ts#evilFn file:src/evil2.ts evilFn"
        }
      ],
      { nodeId: runA.id as string, file: "src/a.ts" }
    );
    expect(evidence.files.map((file) => file.path)).toEqual(["src/a.ts"]);
    expect(evidence.symbols.map((symbol) => symbol.name)).toEqual(["run"]);
    expect(JSON.stringify(evidence)).not.toContain("evil");
  });

  it("TST-B1-008 attributes source only through trusted selection metadata", () => {
    const noFile = buildRetrievalEvidence({ commands: [searchOut([searchHit(runA)]), sourceOk], selection: { nodeId: runA.id as string } });
    expect(noFile.availability).toBe("partial");
    expect(noFile.commands[1]).toMatchObject({ parseState: "unattributable", reason: "no-selected-file-for-source-attribution" });
    expect(noFile.symbols[0].surfacedBy).toEqual(["search"]);

    const unknownNode = buildRetrievalEvidence({
      commands: [searchOut([searchHit(runA)]), sourceOk],
      selection: { nodeId: "symbol:src/never-surfaced.ts#ghost", file: "src/a.ts" }
    });
    expect(unknownNode.symbols).toEqual([{ name: "run", nodeId: runA.id, file: "src/a.ts", surfacedBy: ["search"] }]);
    expect(unknownNode.files).toEqual([{ path: "src/a.ts", surfacedBy: ["search", "source"] }]);
  });

  it("TST-B1-008 does not trust a lifecycle selection when search output was not interpreted", () => {
    const evidence = buildRetrievalEvidence({
      commands: [{ family: "search", ok: true, stdout: JSON.stringify({ results: [{ nodeId: "n", file: "src/a.ts" }] }) }, sourceOk],
      selection: { nodeId: "n", file: "src/a.ts" }
    });
    expect(evidence.availability).toBe("unavailable");
    expect(evidence.files).toEqual([]);
    expect(evidence.commands[1]).toMatchObject({ parseState: "unattributable", reason: "selection-not-backed-by-supported-search-output" });
  });

  it("TST-B1-009 contains no raw or machine-local material", () => {
    const root = "C:/Users/someone/private-repo";
    const searchStdout = JSON.stringify({
      artifactKind: "my-dev-kit-v1-search-result",
      version: "1.0.0",
      indexDir: `${root}/.idx`,
      query: "SOURCE_BODY_MARKER",
      results: [{ ...searchHit(runA), matchReasons: [{ text: "SOURCE_BODY_MARKER" }] }],
      artifactPaths: { manifest: `${root}/.idx/manifest.json` }
    });
    const evidence = buildRetrievalEvidenceFromCommands(
      [
        { commandId: "search", ok: true, stdout: searchStdout },
        { commandId: "lookup", ok: false, stdout: "STDOUT_BODY_MARKER" },
        { commandId: "source", ok: true, stdout: "1 SOURCE_BODY_MARKER" }
      ],
      { nodeId: runA.id as string, file: "src/a.ts" }
    );
    const serialized = JSON.stringify(evidence);
    for (const marker of ["SOURCE_BODY_MARKER", "STDOUT_BODY_MARKER", "private-repo", "someone", ".idx", "node.exe"]) {
      expect(serialized).not.toContain(marker);
    }
    expect(Object.keys(evidence).sort()).toEqual(["availability", "availabilityReason", "commands", "files", "schemaVersion", "symbols"]);
    expect(Object.keys(evidence.commands[0]).sort()).toEqual(["family", "fileEvidenceCount", "parseState", "rejectedIdentityCount", "succeeded", "symbolEvidenceCount"]);
  });

  it("TST-B1-011 normalizes equivalent Windows and POSIX identities consistently and matches the existing contract", () => {
    const equivalents = ["src/a/b.ts", "src\\a\\b.ts", "./src/a/b.ts", ".\\src\\a\\b.ts", "././src/a/b.ts"];
    for (const value of equivalents) {
      expect(normalizeRetrievedRepositoryPath(value), value).toBe("src/a/b.ts");
    }
    const table = [...equivalents, "/abs", "C:\\x", "D:/x", "\\\\unc\\x", "../x", "a/../b", "a//b", "", ".", "a/./b", "a\\..\\b", "a/b/", 42, null, undefined];
    for (const value of table) {
      expect(normalizeRetrievedRepositoryPath(value), String(value)).toBe(normalizeRepositoryRelativePath(value as string));
    }
  });

  it("TST-B1-012 builds deeply equal evidence from semantically identical input", () => {
    const make = (reverse: boolean) => {
      const hits = [searchHit(runA), searchHit(runB), searchHit(fileNode("src/z.ts"))];
      const neighbors = [fileNode("src/y.ts"), symbolNode("src/y.ts", "h")];
      return buildRetrievalEvidence({
        commands: [searchOut(reverse ? [...hits].reverse() : hits), lookupOut(runA, reverse ? [...neighbors].reverse() : neighbors), sliceOut(reverse ? [runB, runA] : [runA, runB]), sourceOk],
        selection: { nodeId: runA.id as string, file: "src/a.ts" }
      });
    };
    const first = make(false);
    expect(make(false)).toEqual(first);
    expect(make(true)).toEqual(first);
    expect(JSON.stringify(make(true))).toBe(JSON.stringify(first));
  });
});
