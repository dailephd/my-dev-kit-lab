// Offline, deterministic stand-in for my-dev-kit that speaks the JSON shapes the context-pack experiment consumes and
// derives its answers from the real files of the repository it is asked to index. Test infrastructure only.
//   CPG_KIT_LOG            append {argv, cwd} per invocation
//   CPG_KIT_MUTATE_FILE    absolute file appended to when `search` runs (a deterministic mutation of the target)
//   CPG_KIT_INDEX_FAIL     when set, `index` exits 1 with a stderr marker
//   CPG_KIT_SEARCH_FAIL    when set, `search` exits 1 with a stderr marker
//   CPG_KIT_SEARCH_EXTRA   repository-relative file additionally surfaced by search as a file node
import fs from "node:fs";
import path from "node:path";

const argv = process.argv.slice(2);
const value = (flag) => {
  const index = argv.indexOf(flag);
  return index >= 0 ? argv[index + 1] : undefined;
};
const values = (flag) => argv.flatMap((entry, index) => (entry === flag ? [argv[index + 1]] : []));
const STDERR_TEXT = "CPG_RAW_STDERR_SENTINEL_9b3a";

if (process.env.CPG_KIT_LOG) fs.appendFileSync(process.env.CPG_KIT_LOG, `${JSON.stringify({ argv, cwd: process.cwd() })}\n`);
const command = argv[0];

function walk(root, relative, excludes, found) {
  for (const entry of fs.readdirSync(path.join(root, relative), { withFileTypes: true })) {
    const child = relative === "" ? entry.name : `${relative}/${entry.name}`;
    if (excludes.some((exclude) => child === exclude || child.startsWith(`${exclude}/`))) continue;
    if (entry.isDirectory()) walk(root, child, excludes, found);
    else if (entry.isFile() && child.endsWith(".ts")) found.push(child);
  }
}

function readIndex(indexDir) {
  return JSON.parse(fs.readFileSync(path.join(indexDir, "symbol-index.json"), "utf8"));
}
const rootOf = (indexDir) => fs.readFileSync(path.join(indexDir, "root.txt"), "utf8");

if (command === "--version") {
  console.log("1.12.5");
} else if (command === "index") {
  if (process.env.CPG_KIT_INDEX_FAIL) {
    process.stderr.write(STDERR_TEXT);
    process.exit(1);
  }
  const root = value("--root");
  const out = value("--out");
  const excludes = values("--exclude");
  const sources = values("--src");
  const files = [];
  for (const source of sources) walk(root, source, excludes, files);
  files.sort();
  const indexed = files.map((file) => {
    const lines = fs.readFileSync(path.join(root, file), "utf8").split("\n");
    const symbols = [];
    lines.forEach((line, index) => {
      const match = /^export function (\w+)/.exec(line);
      if (match) symbols.push({ name: match[1], kind: "function", location: { file, line: index + 1 }, exported: true, signature: `function ${match[1]}` });
    });
    return { path: file, language: "typescript", lineCount: lines.filter((line, index) => index < lines.length - 1 || line !== "").length, imports: [], exports: [], symbols };
  });
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, "symbol-index.json"), JSON.stringify({ schemaVersion: "2", fileCount: indexed.length, files: indexed }));
  fs.writeFileSync(path.join(out, "root.txt"), root);
  console.log("{}");
} else if (command === "search") {
  if (process.env.CPG_KIT_SEARCH_FAIL) {
    process.stderr.write(STDERR_TEXT);
    process.exit(1);
  }
  if (process.env.CPG_KIT_MUTATE_FILE) fs.appendFileSync(process.env.CPG_KIT_MUTATE_FILE, "\n// mutated by the kit\n");
  const index = readIndex(value("--index"));
  const limit = Number(value("--limit") ?? "20");
  const results = [];
  for (const file of index.files) {
    for (const symbol of file.symbols) {
      const id = `symbol:${file.path}#${symbol.name}`;
      results.push({ id, kind: "symbol", label: symbol.name, nodeId: id, path: file.path });
    }
    if (file.path.endsWith(".test.ts")) results.push({ id: `file:${file.path}`, kind: "file", label: path.basename(file.path), nodeId: `file:${file.path}`, path: file.path });
  }
  if (process.env.CPG_KIT_SEARCH_EXTRA) {
    const extra = process.env.CPG_KIT_SEARCH_EXTRA;
    results.push({ id: `file:${extra}`, kind: "file", label: path.basename(extra), nodeId: `file:${extra}`, path: extra });
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
  const index = readIndex(value("--index"));
  const nodes = [];
  const symbolIds = [];
  for (const file of index.files) {
    for (const symbol of file.symbols) {
      const id = `symbol:${file.path}#${symbol.name}`;
      symbolIds.push(id);
      nodes.push({ id, kind: "symbol", path: file.path, symbolName: symbol.name, line: symbol.location.line });
    }
    if (file.path.endsWith(".test.ts")) nodes.push({ id: `file:${file.path}`, kind: "file", path: file.path });
  }
  const edges = symbolIds.length >= 2 ? [{ source: symbolIds[0], target: symbolIds[1], kind: "calls" }] : [];
  console.log(JSON.stringify({ focusNodeId: value("--node"), nodes, edges }));
} else if (command === "source") {
  const indexDir = value("--index");
  const root = rootOf(indexDir);
  const file = value("--file");
  const start = Number(value("--start"));
  const end = Number(value("--end"));
  const lines = fs.readFileSync(path.join(root, file), "utf8").split("\n");
  const last = Math.min(end, lines.length);
  const content = lines.slice(start - 1, last).join("\n");
  console.log(JSON.stringify({ status: "ok", mode: "line-range", startLine: start, endLine: last, content, continuationCursor: { eof: last >= lines.length, symbolBoundaryKnown: true, reason: "window-capped" } }));
} else {
  process.stderr.write("unsupported fake command");
  process.exit(1);
}
