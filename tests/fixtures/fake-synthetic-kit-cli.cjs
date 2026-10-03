#!/usr/bin/env node
// Deterministic, offline my-dev-kit stand-in that works on any generated synthetic repository:
// search resolves the first sym_<n> name in the query to the file defining it; source returns that file.
const fs = require("node:fs");
const path = require("node:path");

const args = process.argv.slice(2);
const arg = (flag) => {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
};
const command = args[0];

if (command === "index") {
  const out = arg("--out");
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, "manifest.json"), JSON.stringify({ ok: true, root: arg("--root") }));
  console.log(JSON.stringify({ ok: true }));
  process.exit(0);
}

const root = () => JSON.parse(fs.readFileSync(path.join(arg("--index"), "manifest.json"), "utf8")).root;
const find = (dir, name) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const found = find(full, name);
      if (found) return found;
    } else if (/\.(ts|py)$/.test(entry.name) && new RegExp("(export function|def) " + name + "\\(").test(fs.readFileSync(full, "utf8"))) {
      return full;
    }
  }
  return null;
};

if (command === "search") {
  const match = /sym_\d+/.exec(arg("--query") || "");
  let results = [];
  if (match) {
    const file = find(root(), match[0]);
    if (file) {
      const rel = path.relative(root(), file).split(path.sep).join("/");
      results = [{ nodeId: "symbol:" + rel + "#" + match[0], file: rel, symbol: match[0] }];
    }
  }
  console.log(JSON.stringify({ results }));
  process.exit(0);
}
if (command === "lookup" || command === "slice") {
  console.log(JSON.stringify({ nodeId: arg("--node"), command }));
  process.exit(0);
}
if (command === "source") {
  const node = arg("--node") || "";
  const rel = node.slice(node.indexOf("symbol:") + 7, node.indexOf("#"));
  const lines = fs.readFileSync(path.join(root(), rel), "utf8").split("\n");
  process.stdout.write(lines.map((line, i) => i + 1 + " " + line).join("\n"));
  process.exit(0);
}
process.stderr.write("unsupported " + command);
process.exit(1);
