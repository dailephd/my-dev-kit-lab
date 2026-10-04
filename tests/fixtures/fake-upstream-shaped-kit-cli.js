#!/usr/bin/env node
// Offline, deterministic stand-in for the published my-dev-kit CLI that emits its real v1 JSON shapes, so retrieval
// evidence is available (not unavailable). Test and acceptance-gate infrastructure only: never packaged, no network.
// Behavior is selected by environment variables so one script covers every scenario:
//   RPR_KIT_LOG            append {argv, cwd} per invocation
//   RPR_KIT_FILES          comma-separated repository-relative files surfaced by search as file nodes (default src/main.ts)
//   RPR_KIT_SYMBOLS        semicolon-separated "name@file" symbols surfaced by search
//   RPR_KIT_MUTATE_FILE    absolute file appended to when `search` runs (a deterministic mutation of the target)
//   RPR_KIT_FAIL           command name that exits 1 with a stderr marker
//   RPR_KIT_INDEX_FAIL     when set, `index` exits 1
//   RPR_KIT_SOURCE_TEXT / RPR_KIT_STDOUT_TEXT / RPR_KIT_STDERR_TEXT   markers placed in raw command output
import fs from "node:fs";
import path from "node:path";

const argv = process.argv.slice(2);
const value = (flag) => {
  const index = argv.indexOf(flag);
  return index >= 0 ? argv[index + 1] : undefined;
};
const SOURCE_TEXT = process.env.RPR_KIT_SOURCE_TEXT || "RPR_SOURCE_BODY_SENTINEL_9d1c";
const STDOUT_TEXT = process.env.RPR_KIT_STDOUT_TEXT || "RPR_RAW_STDOUT_SENTINEL_44ab";
const STDERR_TEXT = process.env.RPR_KIT_STDERR_TEXT || "RPR_RAW_STDERR_SENTINEL_71ef";

if (process.env.RPR_KIT_LOG) fs.appendFileSync(process.env.RPR_KIT_LOG, `${JSON.stringify({ argv, cwd: process.cwd() })}\n`);
const command = argv[0];
if (process.env.RPR_KIT_FAIL === command) {
  process.stderr.write(STDERR_TEXT);
  process.exit(1);
}

if (command === "--version") {
  console.log("fake-upstream-shaped-kit 0.0.0");
} else if (command === "index") {
  if (process.env.RPR_KIT_INDEX_FAIL) {
    process.stderr.write(STDERR_TEXT);
    process.exit(1);
  }
  const out = value("--out");
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, "manifest.json"), "{}");
  console.log(JSON.stringify({ ok: true }));
} else if (command === "search") {
  if (process.env.RPR_KIT_MUTATE_FILE) fs.appendFileSync(process.env.RPR_KIT_MUTATE_FILE, "\n// mutated by the kit\n");
  const files = (process.env.RPR_KIT_FILES || "src/main.ts").split(",").filter(Boolean);
  const symbols = (process.env.RPR_KIT_SYMBOLS || "").split(";").filter(Boolean).map((entry) => entry.split("@"));
  const results = [
    ...files.map((file) => ({ kind: "file", id: `file:${file}`, label: path.basename(file), path: file, nodeId: `file:${file}`, score: 10, matchReasons: [] })),
    ...symbols.map(([name, file]) => ({ kind: "symbol", id: `symbol:${file}#${name}`, label: name, path: file, nodeId: `symbol:${file}#${name}`, score: 9, matchReasons: [] }))
  ];
  console.log(JSON.stringify({ artifactKind: "my-dev-kit-v1-search-result", version: "1.0.0", query: "q", results }));
} else {
  const node = value("--node") || "file:src/main.ts";
  const nodePath = node.replace(/^(file|symbol):/, "").split("#")[0];
  const shape = { id: node, kind: node.startsWith("symbol:") ? "symbol" : "file", label: path.basename(nodePath), path: nodePath };
  if (command === "lookup") {
    console.log(JSON.stringify({ status: "found", node: shape, neighbors: [], incomingEdges: [], outgoingEdges: [] }));
  } else if (command === "slice") {
    console.log(JSON.stringify({ artifactKind: "my-dev-kit-v1-graph-slice", version: "1.0.0", nodes: [shape], edges: [] }));
  } else if (command === "source") {
    process.stderr.write(STDERR_TEXT);
    process.stdout.write(`1 // ${SOURCE_TEXT} ${STDOUT_TEXT}\n`);
  } else {
    process.stderr.write("unsupported fake command");
    process.exit(1);
  }
}
