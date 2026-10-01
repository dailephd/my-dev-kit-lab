#!/usr/bin/env node
// Deterministic, offline my-dev-kit stand-in for the context-window-scaling fixed project.
// search selects the single task module whose keyword appears in the query; source returns the
// real committed file with line numbers. Unknown queries return no candidates (retrieval skipped).
import fs from "node:fs";
import path from "node:path";

const PROJECT_ROOT = path.join(process.cwd(), "benchmarks", "projects", "context-window-scaling-fixed-ts");
const MODULES = [
  { keyword: "shipping", file: "src/tasks/shippingQuote.ts", symbol: "calculateShippingQuote" },
  { keyword: "invoice", file: "src/tasks/invoiceTotals.ts", symbol: "calculateInvoiceTotal" },
  { keyword: "reserve", file: "src/tasks/inventoryReservation.ts", symbol: "reserveStock" },
  { keyword: "audit", file: "src/tasks/auditRedaction.ts", symbol: "redactAuditEntry" },
];

function argValue(flag) {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const command = process.argv[2];
if (command === "index") {
  const outDir = argValue("--out");
  if (outDir) {
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, "manifest.json"), JSON.stringify({ ok: true, fake: true }));
  }
  console.log(JSON.stringify({ ok: true, command: "index", outDir }));
  process.exit(0);
}

if (command === "search") {
  const query = String(argValue("--query") ?? "").toLowerCase();
  const match = MODULES.find((module) => query.includes(module.keyword));
  const results = match ? [{ nodeId: `symbol:${match.file}#${match.symbol}`, file: match.file, symbol: match.symbol }] : [];
  console.log(JSON.stringify({ results }));
  process.exit(0);
}

if (command === "lookup" || command === "slice") {
  console.log(JSON.stringify({ nodeId: argValue("--node"), command }));
  process.exit(0);
}

if (command === "source") {
  const node = String(argValue("--node") ?? "");
  const match = MODULES.find((module) => node.includes(module.file));
  if (!match) {
    process.stderr.write(`Unknown node: ${node}`);
    process.exit(1);
  }
  const lines = fs.readFileSync(path.join(PROJECT_ROOT, match.file), "utf8").split(/\r?\n/);
  process.stdout.write(lines.map((line, index) => `${index + 1} ${line}`).join("\n"));
  process.exit(0);
}

process.stderr.write(`Unsupported fake my-dev-kit command: ${command}`);
process.exit(1);
