// Offline, deterministic stand-in for my-dev-kit used ONLY by the packed-package acceptance gate (never packaged). It
// answers from the real files of the repository it is asked to index (Node ESM benchmark projects) and deliberately
// surfaces trusted-test decoys so the gate can prove the Lab filters them before retrieval. It speaks exactly the JSON
// shapes the agent-success-rate context-pack treatment consumes (the same shapes as the released context-pack fake kit).
//   ASR_KIT_LOG   append {argv, cwd} per invocation
import fs from "node:fs";
import path from "node:path";

export const FAKE_KIT_DECOY_MARKER = "PACKED_ASR_DECOY_TRUSTED_CONTENT_6c1e";
export const FAKE_KIT_DECOY_PATH = "tests/decoy-trusted.check.mjs";

const argv = process.argv.slice(2);
const value = (flag) => {
  const index = argv.indexOf(flag);
  return index >= 0 ? argv[index + 1] : undefined;
};
const values = (flag) => argv.flatMap((entry, index) => (entry === flag ? [argv[index + 1]] : []));

if (process.env.ASR_KIT_LOG) fs.appendFileSync(process.env.ASR_KIT_LOG, `${JSON.stringify({ argv, cwd: process.cwd() })}\n`);
const command = argv[0];

function walk(root, relative, excludes, found) {
  for (const entry of fs.readdirSync(path.join(root, relative), { withFileTypes: true })) {
    const child = relative === "" ? entry.name : `${relative}/${entry.name}`;
    if (excludes.some((exclude) => child === exclude || child.startsWith(`${exclude}/`))) continue;
    if (entry.isDirectory()) walk(root, child, excludes, found);
    else if (entry.isFile() && /\.(c|m)?js$/.test(entry.name)) found.push(child);
  }
}

const readIndex = (indexDir) => JSON.parse(fs.readFileSync(path.join(indexDir, "symbol-index.json"), "utf8"));
const rootOf = (indexDir) => fs.readFileSync(path.join(indexDir, "root.txt"), "utf8");

function symbolsOf(file, lines) {
  const symbols = [];
  lines.forEach((line, index) => {
    const match = /^export (?:async )?(?:function|class) (\w+)/.exec(line) ?? /^export const (\w+) =/.exec(line);
    if (match) symbols.push({ name: match[1], kind: "function", location: { file, line: index + 1 }, exported: true, signature: `function ${match[1]}` });
  });
  return symbols;
}

// Decoy identities that point at trusted checks. A correct Lab drops every one of them before selecting or reading source.
function decoyHits(root) {
  const hits = [{ id: `symbol:${FAKE_KIT_DECOY_PATH}#decoyTrusted`, kind: "symbol", label: "decoyTrusted", nodeId: `symbol:${FAKE_KIT_DECOY_PATH}#decoyTrusted`, path: FAKE_KIT_DECOY_PATH }];
  const testsDir = path.join(root, "tests");
  if (fs.existsSync(testsDir)) {
    for (const entry of fs.readdirSync(testsDir).sort()) {
      hits.push({ id: `file:tests/${entry}`, kind: "file", label: entry, nodeId: `file:tests/${entry}`, path: `tests/${entry}` });
    }
  }
  return hits;
}

if (command === "--version") {
  console.log("1.12.5");
} else if (command === "index") {
  const root = value("--root");
  const out = value("--out");
  const excludes = values("--exclude");
  const files = [];
  for (const source of values("--src")) walk(root, source, excludes, files);
  files.sort();
  const indexed = files.map((file) => {
    const lines = fs.readFileSync(path.join(root, file), "utf8").split("\n");
    return {
      path: file,
      language: "javascript",
      lineCount: lines.filter((line, index) => index < lines.length - 1 || line !== "").length,
      imports: [],
      exports: [],
      symbols: symbolsOf(file, lines)
    };
  });
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, "symbol-index.json"), JSON.stringify({ schemaVersion: "2", fileCount: indexed.length, files: indexed }));
  fs.writeFileSync(path.join(out, "root.txt"), root);
  console.log("{}");
} else if (command === "search") {
  const indexDir = value("--index");
  const index = readIndex(indexDir);
  const limit = Number(value("--limit") ?? "20");
  const results = [...decoyHits(rootOf(indexDir))];
  for (const file of index.files) {
    for (const symbol of file.symbols) {
      const id = `symbol:${file.path}#${symbol.name}`;
      results.push({ id, kind: "symbol", label: symbol.name, nodeId: id, path: file.path });
    }
  }
  console.log(JSON.stringify({ artifactKind: "my-dev-kit-v1-search-result", results: results.slice(0, limit).map((hit, rank) => ({ ...hit, score: 100 - rank })) }));
} else if (command === "lookup") {
  const index = readIndex(value("--index"));
  const nodeId = value("--node");
  const match = /^symbol:([^#]+)#(.+)$/.exec(nodeId);
  if (match) {
    const file = index.files.find((entry) => entry.path === match[1]);
    const symbol = file?.symbols.find((entry) => entry.name === match[2]);
    console.log(JSON.stringify({ status: "found", node: { id: nodeId, kind: "symbol", path: match[1], symbolName: match[2], line: symbol?.location.line ?? 1 }, incomingEdges: [], outgoingEdges: [] }));
  } else {
    console.log(JSON.stringify({ status: "found", node: { id: nodeId, kind: "file", path: nodeId.replace(/^file:/, "") }, incomingEdges: [], outgoingEdges: [] }));
  }
} else if (command === "slice") {
  const indexDir = value("--index");
  const index = readIndex(indexDir);
  const nodes = [];
  const symbolIds = [];
  for (const file of index.files) {
    for (const symbol of file.symbols) {
      const id = `symbol:${file.path}#${symbol.name}`;
      symbolIds.push(id);
      nodes.push({ id, kind: "symbol", path: file.path, symbolName: symbol.name, line: symbol.location.line });
    }
  }
  for (const hit of decoyHits(rootOf(indexDir))) nodes.push({ id: hit.nodeId, kind: hit.kind, path: hit.path, ...(hit.kind === "symbol" ? { symbolName: hit.label, line: 1 } : {}) });
  const edges = symbolIds.length >= 2 ? [{ source: symbolIds[0], target: symbolIds[1], kind: "calls" }] : [];
  if (symbolIds.length >= 1) edges.push({ source: `symbol:${FAKE_KIT_DECOY_PATH}#decoyTrusted`, target: symbolIds[0], kind: "calls" });
  console.log(JSON.stringify({ focusNodeId: value("--node"), nodes, edges }));
} else if (command === "source") {
  const indexDir = value("--index");
  const file = value("--file");
  const start = Number(value("--start"));
  const end = Number(value("--end"));
  if (file === FAKE_KIT_DECOY_PATH) {
    console.log(JSON.stringify({ status: "ok", mode: "line-range", startLine: 1, endLine: 1, content: FAKE_KIT_DECOY_MARKER, continuationCursor: { eof: true, symbolBoundaryKnown: true, reason: "window-capped" } }));
  } else {
    const lines = fs.readFileSync(path.join(rootOf(indexDir), file), "utf8").split("\n");
    const last = Math.min(end, lines.length);
    console.log(JSON.stringify({ status: "ok", mode: "line-range", startLine: start, endLine: last, content: lines.slice(start - 1, last).join("\n"), continuationCursor: { eof: last >= lines.length, symbolBoundaryKnown: true, reason: "window-capped" } }));
  }
} else {
  process.stderr.write("unsupported fake command");
  process.exit(1);
}
