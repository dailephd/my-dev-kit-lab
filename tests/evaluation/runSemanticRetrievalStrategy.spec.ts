import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  CORE_GRAPH_RETRIEVAL_QUERY_STRATEGY_IDS,
  RETRIEVAL_QUERY_STRATEGY_IDS,
  SEMANTIC_RETRIEVAL_QUERY_STRATEGY_IDS,
  isSemanticRetrievalQueryStrategyId
} from "../../src/evaluation/retrievalQueryStrategies.js";
import { buildMyDevKitIndex, runMyDevKitRetrievalStrategyFromIndex } from "../../src/evaluation/runMyDevKitRetrieval.js";
import {
  runSemanticRetrievalStrategyFromIndex,
  scoreSemanticLabel,
  tokenizeSemanticRetrievalQuery,
  type SemanticRetrievalStrategyId
} from "../../src/evaluation/runSemanticRetrievalStrategy.js";
import type { EvaluationCase } from "../../src/evaluation/types.js";

const fakeKitPath = path.resolve(process.cwd(), "tests/fixtures/fake-my-dev-kit-cli.js");
const tempDirs: string[] = [];
afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

const baseCase: EvaluationCase = {
  id: "semantic-case",
  title: "Case",
  benchmarkProject: "todo-ts",
  targetRoot: "benchmarks/projects/todo-ts",
  absoluteTargetRoot: path.resolve(process.cwd(), "benchmarks/projects/todo-ts"),
  sourceRoots: ["src", "tests"],
  query: "update user email",
  expectedFiles: ["src/zzz.ts"],
  expectedSymbols: ["zzz"],
  rawIncludeGlobs: ["src/**/*"]
};

const ref = (filePath: string) => ({ filePath, symbolId: `symbol:${filePath}#x`, nodeId: null, evidenceId: null, evidenceKind: "source", line: 1, column: 1 });
const node = (kind: "entity" | "field", label: string, id?: string) => ({
  id: id ?? (kind === "entity" ? `data-model-entity:${label}` : `data-model-field:${label}`),
  kind,
  label,
  entityId: null,
  fieldId: null,
  parentEntityId: null,
  sourceRefs: [],
  warnings: []
});
const graphOf = (nodes: unknown[], overrides: Record<string, unknown> = {}) => ({
  artifactKind: "my-dev-kit-v1-data-model-graph",
  schemaVersion: "1.1.0",
  nodes,
  edges: [],
  ...overrides
});
const defaultGraph = graphOf([node("entity", "User"), node("field", "User.email"), node("field", "User.name")]);

type FakeConfig = {
  graph?: unknown; // object serialized as JSON, or a raw string
  noGraph?: boolean;
  generateFails?: boolean;
  selectedFails?: boolean; // entity/field lookup or trace command fails
  entity?: unknown;
  field?: unknown;
  traceEntity?: unknown;
  traceField?: unknown;
};

const entityOutput = (refs: unknown[]) => ({ status: "ok", mode: "entity", entity: { id: "entity:User", name: "User" }, sourceRefs: refs });
const fieldOutput = (refs: unknown[]) => ({
  status: "ok",
  mode: "field",
  entity: { id: "entity:User", name: "User" },
  field: { id: "field:User.email", name: "email" },
  sourceRefs: refs
});
const lineageNode = (id: string, label: string, refs: unknown[]) => ({
  id,
  kind: "data-field",
  label,
  confidence: "explicit",
  dataModelEntityId: null,
  dataModelFieldId: null,
  evidenceRefs: refs,
  warnings: []
});
const traceOutput = (mode: "trace-entity" | "trace-field", nodes: unknown[]) => ({
  status: "ok",
  mode,
  entity: { id: "entity:User", name: "User" },
  ...(mode === "trace-field" ? { field: { id: "field:User.email", name: "email", typeText: "string" } } : {}),
  lineageNodeCount: nodes.length,
  lineageEdgeCount: 1,
  lineage: { nodes, edges: [{ id: "edge:1", kind: "flows-to" }] },
  warnings: []
});

// Test-local fake kit: only the `data-model` command, driven by an embedded config.
function writeFakeSemanticKit(dir: string, config: FakeConfig): string {
  const scriptPath = path.join(dir, "fake-semantic-kit.mjs");
  writeFileSync(
    scriptPath,
    [
      `import fs from "node:fs"; import path from "node:path";`,
      `const config = ${JSON.stringify(config)};`,
      `const args = process.argv.slice(2);`,
      `const val = (flag) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : undefined; };`,
      `const out = (value) => process.stdout.write(typeof value === "string" ? value : JSON.stringify(value));`,
      `if (args[0] !== "data-model") { process.stderr.write("unsupported"); process.exit(1); }`,
      `const hasSelector = args.includes("--entity") || args.includes("--field") || args.includes("--trace-view");`,
      `if (!hasSelector) {`,
      `  if (config.generateFails) { process.stderr.write("generate failed"); process.exit(1); }`,
      `  if (!config.noGraph) fs.writeFileSync(path.join(val("--index"), "data-model-graph.json"), typeof config.graph === "string" ? config.graph : JSON.stringify(config.graph));`,
      `  out({ status: "ok", mode: "generate" }); process.exit(0);`,
      `}`,
      `if (config.selectedFails) { process.stderr.write("selected failed"); process.exit(1); }`,
      `if (args.includes("--trace-view")) { out(args.includes("--field") ? config.traceField : config.traceEntity); process.exit(0); }`,
      `out(args.includes("--field") ? config.field : config.entity);`
    ].join("\n")
  );
  return `node ${scriptPath}`;
}

function setup(config: FakeConfig) {
  const dir = mkdtempSync(path.join(os.tmpdir(), "kit-semantic-"));
  tempDirs.push(dir);
  const indexDir = path.join(dir, "index");
  mkdirSync(indexDir, { recursive: true });
  return { dir, indexDir, commandsDir: path.join(dir, "commands"), kitCommand: writeFakeSemanticKit(dir, { graph: defaultGraph, ...config }) };
}

async function run(
  strategyId: SemanticRetrievalStrategyId,
  config: FakeConfig,
  options: { requireKit?: boolean; evaluationCase?: EvaluationCase } = {}
) {
  const prepared = setup(config);
  const result = await runSemanticRetrievalStrategyFromIndex({
    strategyId,
    evaluationCase: options.evaluationCase ?? baseCase,
    kitCommand: prepared.kitCommand,
    indexDir: prepared.indexDir,
    commandsDir: prepared.commandsDir,
    requireKit: options.requireKit ?? false
  });
  return { result, prepared };
}

const selectorArgs = (command: { args: string[] }) => command.args.slice(command.args.indexOf("--index") + 2);

describe("semantic strategy identities (TST-081-011)", () => {
  it("declares exactly the two semantic ids and keeps the seven-id order", () => {
    expect(SEMANTIC_RETRIEVAL_QUERY_STRATEGY_IDS).toEqual(["data-model-graph", "model-view-lineage"]);
    expect(isSemanticRetrievalQueryStrategyId("data-model-graph")).toBe(true);
    expect(isSemanticRetrievalQueryStrategyId("model-view-lineage")).toBe(true);
    for (const id of CORE_GRAPH_RETRIEVAL_QUERY_STRATEGY_IDS) {
      expect(isSemanticRetrievalQueryStrategyId(id)).toBe(false);
    }
    expect(RETRIEVAL_QUERY_STRATEGY_IDS).toEqual([
      "keyword-search",
      "symbol-lookup",
      "graph-neighborhood",
      "source-slice",
      "data-model-graph",
      "model-view-lineage",
      "combined-graph-guided"
    ]);
  });
});

describe("query tokenization and label scoring", () => {
  it("TST-081-012: tokenizes deterministically", () => {
    expect(tokenizeSemanticRetrievalQuery("User email settings")).toEqual(["email", "settings", "user"]);
    expect(tokenizeSemanticRetrievalQuery("User.email / user-email")).toEqual(["email", "user"]);
    expect(tokenizeSemanticRetrievalQuery("A x B")).toEqual([]);
    expect(tokenizeSemanticRetrievalQuery("b2 a1 B2")).toEqual(["a1", "b2"]);
  });

  it("TST-081-013: scores unique exact token overlap only", () => {
    const tokens = ["email", "settings", "user"];
    expect(scoreSemanticLabel(tokens, "User.email")).toBe(2);
    expect(scoreSemanticLabel(tokens, "Settings")).toBe(1);
    expect(scoreSemanticLabel(tokens, "Profile")).toBe(0);
    expect(scoreSemanticLabel(["user"], "username")).toBe(0);
  });
});

describe("data-model-graph strategy", () => {
  it("TST-081-014: selects the highest-scoring node and runs the exact field command", async () => {
    const { result, prepared } = await run("data-model-graph", { field: fieldOutput([ref("src/user.ts")]) });
    expect(result.commands.map((command) => selectorArgs(command))).toEqual([
      ["--json"],
      ["--field", "User.email", "--json"]
    ]);
    for (const command of result.commands) {
      expect(command.args[command.args.indexOf("--index") + 1]).toBe(prepared.indexDir);
    }
    expect(result.queryStrategyEvidence.availability).toBe("available");
    expect(result.queryStrategyEvidence.steps.map((s) => s.kind)).toEqual(["data-model", "data-model"]);
    expect(result.contextText).toBe(result.commands[1].stdout);
    expect(result.skipped).toBe(false);
  });

  it("selects an entity node with --entity", async () => {
    const { result } = await run(
      "data-model-graph",
      { graph: graphOf([node("entity", "User"), node("field", "Order.total")]), entity: entityOutput([ref("src/user.ts")]) },
      { evaluationCase: { ...baseCase, query: "user" } }
    );
    expect(selectorArgs(result.commands[1])).toEqual(["--entity", "User", "--json"]);
    expect(result.queryStrategyEvidence.symbols).toEqual([{ name: "User", nodeId: "entity:User", file: "src/user.ts" }]);
  });

  it("TST-081-015: breaks score ties by node id in code-unit order, not artifact order", async () => {
    const graph = graphOf([node("field", "Zed.email", "node-b"), node("field", "Abc.email", "node-a"), node("field", "Mid.email", "node-c")]);
    const { result } = await run(
      "data-model-graph",
      { graph, field: fieldOutput([ref("src/user.ts")]) },
      { evaluationCase: { ...baseCase, query: "email" } }
    );
    expect(selectorArgs(result.commands[1])).toEqual(["--field", "Abc.email", "--json"]);
  });

  it("TST-081-016: returns available empty evidence and runs only generation when nothing matches", async () => {
    const { result } = await run("data-model-graph", {}, { evaluationCase: { ...baseCase, query: "zebra giraffe" } });
    expect(result.commands).toHaveLength(1);
    expect(result.skipped).toBe(true);
    expect(result.contextText).toBe("");
    expect(result.warnings).toEqual([]);
    expect(result.queryStrategyEvidence).toMatchObject({
      availability: "available",
      availabilityReason: null,
      files: [],
      symbols: [],
      steps: [{ kind: "data-model", succeeded: true, evidenceAvailable: true, reason: null }]
    });
  });

  it("TST-081-017: normalizes and deduplicates source refs and builds one semantic symbol", async () => {
    const { result } = await run("data-model-graph", {
      field: fieldOutput([ref("./src\\user.ts"), ref("src/user.ts"), ref("src/user.ts")])
    });
    expect(result.queryStrategyEvidence.files).toEqual([{ path: "src/user.ts" }]);
    expect(result.queryStrategyEvidence.symbols).toEqual([{ name: "email", nodeId: "field:User.email", file: "src/user.ts" }]);
  });

  it("leaves the symbol file null when several files are referenced", async () => {
    const { result } = await run("data-model-graph", { field: fieldOutput([ref("src/b.ts"), ref("src/a.ts")]) });
    expect(result.queryStrategyEvidence.files).toEqual([{ path: "src/a.ts" }, { path: "src/b.ts" }]);
    expect(result.queryStrategyEvidence.symbols[0].file).toBeNull();
  });

  it("TST-081-018: omits unsafe identities and reports partial evidence without echoing them", async () => {
    const { result } = await run("data-model-graph", {
      field: fieldOutput([ref("C:\\secret\\file.ts"), ref("../outside.ts"), ref("src/user.ts")])
    });
    const evidence = result.queryStrategyEvidence;
    expect(evidence.availability).toBe("partial");
    expect(evidence.availabilityReason).toBe("some-semantic-identities-were-rejected");
    expect(evidence.files).toEqual([{ path: "src/user.ts" }]);
    const durable = JSON.stringify([evidence, result.warnings]);
    expect(durable).not.toContain("secret");
    expect(durable).not.toContain("outside");
  });
});

describe("model-view-lineage strategy", () => {
  it("TST-081-019: traces an entity with --trace-view <entity>", async () => {
    const { result } = await run(
      "model-view-lineage",
      { graph: graphOf([node("entity", "User")]), traceEntity: traceOutput("trace-entity", [lineageNode("l:1", "User", [ref("src/user.ts")])]) },
      { evaluationCase: { ...baseCase, query: "user" } }
    );
    expect(result.commands.map((command) => selectorArgs(command))).toEqual([["--json"], ["--trace-view", "User", "--json"]]);
    expect(result.queryStrategyEvidence.strategyId).toBe("model-view-lineage");
    expect(result.queryStrategyEvidence.steps.map((s) => s.kind)).toEqual(["data-model", "model-view-lineage"]);
    expect(result.contextText).toBe(result.commands[1].stdout);
  });

  it("TST-081-020: traces a field with --field <field> --trace-view and no value after it", async () => {
    const { result } = await run("model-view-lineage", {
      traceField: traceOutput("trace-field", [lineageNode("l:1", "User.email", [ref("src/user.ts")])])
    });
    expect(selectorArgs(result.commands[1])).toEqual(["--field", "User.email", "--trace-view", "--json"]);
    expect(result.queryStrategyEvidence.availability).toBe("available");
  });

  it("TST-081-021: derives files and symbols from lineage nodes only", async () => {
    const { result } = await run("model-view-lineage", {
      traceField: traceOutput("trace-field", [
        lineageNode("l:profile", "Profile.email", [ref("src/profile.ts")]),
        lineageNode("l:user", "User.email", [ref("src/user.ts"), ref("src/user.ts")]),
        lineageNode("l:vm", "UserViewModel.email", [ref("src/view.tsx"), ref("src/user.ts")])
      ])
    });
    const evidence = result.queryStrategyEvidence;
    expect(evidence.files).toEqual([{ path: "src/profile.ts" }, { path: "src/user.ts" }, { path: "src/view.tsx" }]);
    expect(evidence.symbols).toEqual([
      { name: "UserViewModel.email", nodeId: "l:vm", file: null },
      { name: "Profile.email", nodeId: "l:profile", file: "src/profile.ts" },
      { name: "User.email", nodeId: "l:user", file: "src/user.ts" }
    ]);
    expect(evidence.symbols.some((symbol) => symbol.nodeId === "edge:1")).toBe(false);
  });

  it("reports partial evidence for an unsafe lineage evidence ref", async () => {
    const { result } = await run("model-view-lineage", {
      traceField: traceOutput("trace-field", [lineageNode("l:1", "User.email", [ref("/abs/path.ts"), ref("src/user.ts")])])
    });
    expect(result.queryStrategyEvidence.availability).toBe("partial");
    expect(result.queryStrategyEvidence.availabilityReason).toBe("some-semantic-identities-were-rejected");
    expect(JSON.stringify(result.queryStrategyEvidence)).not.toContain("abs/path");
  });

  it("TST-081-022: runs no trace command when nothing matches", async () => {
    const { result } = await run("model-view-lineage", {}, { evaluationCase: { ...baseCase, query: "zebra giraffe" } });
    expect(result.commands).toHaveLength(1);
    expect(result.skipped).toBe(true);
    expect(result.queryStrategyEvidence).toMatchObject({
      availability: "available",
      availabilityReason: null,
      files: [],
      symbols: [],
      steps: [{ kind: "data-model", succeeded: true, evidenceAvailable: true, reason: null }]
    });
  });
});

describe("contract validation (TST-081-023)", () => {
  const goodField = fieldOutput([ref("src/user.ts")]);
  const goodTraceField = traceOutput("trace-field", [lineageNode("l:1", "User.email", [ref("src/user.ts")])]);
  const goodTraceEntity = traceOutput("trace-entity", [lineageNode("l:1", "User", [ref("src/user.ts")])]);
  const entityGraph = graphOf([node("entity", "User")]);
  const entityCase = { ...baseCase, query: "user" };

  it.each([
    { name: "malformed graph JSON", strategy: "data-model-graph", config: { graph: "{not json" }, reason: "data-model-graph-artifact-malformed" },
    { name: "wrong graph artifactKind", strategy: "data-model-graph", config: { graph: graphOf([], { artifactKind: "other" }) }, reason: "data-model-graph-schema-unsupported" },
    { name: "unsupported graph schema major", strategy: "model-view-lineage", config: { graph: graphOf([], { schemaVersion: "2.0.0" }) }, reason: "data-model-graph-schema-unsupported" },
    { name: "missing graph artifact", strategy: "model-view-lineage", config: { noGraph: true }, reason: "data-model-graph-artifact-missing" },
    { name: "malformed entity lookup output", strategy: "data-model-graph", config: { graph: entityGraph, entity: "not json" }, reason: "data-model-lookup-output-malformed", entity: true },
    { name: "field node receiving entity output", strategy: "data-model-graph", config: { field: entityOutput([ref("src/user.ts")]) }, reason: "data-model-lookup-output-mismatched" },
    { name: "lookup output without sourceRefs array", strategy: "data-model-graph", config: { field: { ...goodField, sourceRefs: "x" } }, reason: "data-model-lookup-output-malformed" },
    { name: "malformed lineage output", strategy: "model-view-lineage", config: { traceField: "not json" }, reason: "model-view-lineage-output-malformed" },
    { name: "lineage output without nodes", strategy: "model-view-lineage", config: { traceField: { ...goodTraceField, lineage: {} } }, reason: "model-view-lineage-output-malformed" },
    { name: "entity selection receiving trace-field", strategy: "model-view-lineage", config: { graph: entityGraph, traceEntity: goodTraceField }, reason: "model-view-lineage-output-mismatched", entity: true },
    { name: "field selection receiving trace-entity", strategy: "model-view-lineage", config: { traceField: goodTraceEntity }, reason: "model-view-lineage-output-mismatched" }
  ] as Array<{ name: string; strategy: SemanticRetrievalStrategyId; config: FakeConfig; reason: string; entity?: boolean }>)(
    "returns unavailable evidence for $name",
    async ({ strategy, config, reason, entity }) => {
      const { result } = await run(strategy, config, { evaluationCase: entity ? entityCase : baseCase });
      expect(result.queryStrategyEvidence.availability).toBe("unavailable");
      expect(result.queryStrategyEvidence.availabilityReason).toBe(reason);
      expect(result.queryStrategyEvidence.files).toEqual([]);
      expect(result.queryStrategyEvidence.symbols).toEqual([]);
      expect(result.skipped).toBe(true);
      expect(result.contextText).toBe("");
    }
  );
});

describe("requireKit policy (TST-081-024)", () => {
  it.each([
    { strategy: "data-model-graph", config: { generateFails: true }, reason: "data-model-command-failed" },
    { strategy: "data-model-graph", config: { selectedFails: true }, reason: "data-model-lookup-command-failed" },
    { strategy: "model-view-lineage", config: { generateFails: true }, reason: "data-model-command-failed" },
    { strategy: "model-view-lineage", config: { selectedFails: true }, reason: "model-view-lineage-command-failed" }
  ] as Array<{ strategy: SemanticRetrievalStrategyId; config: FakeConfig; reason: string }>)(
    "$strategy: $reason is unavailable without requireKit and throws with it",
    async ({ strategy, config, reason }) => {
      const { result } = await run(strategy, config, { requireKit: false });
      expect(result.queryStrategyEvidence.availability).toBe("unavailable");
      expect(result.queryStrategyEvidence.availabilityReason).toBe(reason);
      expect(result.skipped).toBe(true);
      await expect(run(strategy, config, { requireKit: true })).rejects.toThrow();
    }
  );
});

describe("core strategy adapter (TST-081-025)", () => {
  it.each(CORE_GRAPH_RETRIEVAL_QUERY_STRATEGY_IDS)("%s carries queryStrategyEvidence agreeing with retrievalEvidence", async (strategyId) => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "kit-adapter-"));
    tempDirs.push(dir);
    const kitCommand = `node ${fakeKitPath}`;
    const indexDir = path.join(dir, "index");
    await buildMyDevKitIndex({ target: baseCase, kitCommand, indexDir, commandsDir: path.join(dir, "index-commands"), requireKit: true });
    const result = await runMyDevKitRetrievalStrategyFromIndex({
      strategyId,
      evaluationCase: { ...baseCase, benchmarkProject: "todo-ts", query: "create task" },
      kitCommand: `${kitCommand}`,
      indexDir,
      commandsDir: path.join(dir, "commands"),
      requireKit: true
    });
    const retrieval = result.retrievalEvidence;
    const strategy = result.queryStrategyEvidence;
    expect(retrieval).toBeDefined();
    expect(strategy).toBeDefined();
    expect(strategy?.schemaVersion).toBe("retrieval-query-strategy-evidence-v1");
    expect(strategy?.strategyId).toBe(strategyId);
    expect(strategy?.availability).toBe(retrieval?.availability);
    expect(strategy?.availabilityReason).toBe(retrieval?.availabilityReason ?? null);
    expect(strategy?.files).toEqual(retrieval?.files.map(({ path: p }) => ({ path: p })));
    expect(strategy?.symbols).toEqual(
      retrieval?.symbols.map((symbol) => ({ name: symbol.name, nodeId: symbol.nodeId ?? null, file: symbol.file ?? null }))
    );
    expect(strategy?.steps.map((s) => s.kind)).toEqual(retrieval?.commands.map((command) => command.family));
  });
});

describe("answer-key independence (TST-081-026)", () => {
  it.each(SEMANTIC_RETRIEVAL_QUERY_STRATEGY_IDS)("%s selection ignores expected files and symbols", async (strategyId) => {
    const config: FakeConfig = {
      field: fieldOutput([ref("src/user.ts")]),
      traceField: traceOutput("trace-field", [lineageNode("l:1", "User.email", [ref("src/user.ts")])])
    };
    const other: EvaluationCase = { ...baseCase, expectedFiles: ["src/other.ts"], expectedSymbols: ["name", "User.name"] };
    const a = await run(strategyId, config, { evaluationCase: baseCase });
    const b = await run(strategyId, config, { evaluationCase: other });
    const shape = (commands: Array<{ args: string[] }>) => commands.map((command) => selectorArgs(command));
    expect(shape(b.result.commands)).toEqual(shape(a.result.commands));
    expect(b.result.queryStrategyEvidence).toEqual(a.result.queryStrategyEvidence);
  });
});
