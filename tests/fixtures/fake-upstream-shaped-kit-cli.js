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
//   RPR_KIT_DATA_MODEL_ENTITY / RPR_KIT_DATA_MODEL_FIELD   the one entity and field `data-model` exposes (default Task / id);
//                          the first RPR_KIT_FILES file is the semantic source reference (default src/main.ts)
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
} else if (command === "data-model") {
  // Deterministic stand-in for the real v1 `data-model` command shapes (generate, entity/field lookup, trace-view).
  const entityName = process.env.RPR_KIT_DATA_MODEL_ENTITY || "Task";
  const fieldName = process.env.RPR_KIT_DATA_MODEL_FIELD || "id";
  const firstFile = (process.env.RPR_KIT_FILES || "src/main.ts").split(",").filter(Boolean)[0] || "src/main.ts";
  const createdAt = "2026-01-01T00:00:00.000Z";
  const entityId = `entity:${entityName}`;
  const fieldId = `field:${entityName}.${fieldName}`;
  const sourceRefs = [{ filePath: firstFile }];
  const traceIndex = argv.indexOf("--trace-view");
  const traceValue = traceIndex >= 0 && argv[traceIndex + 1] && !argv[traceIndex + 1].startsWith("--") ? argv[traceIndex + 1] : undefined;
  const fieldSelector = value("--field");
  const entitySelector = value("--entity");
  const requestedFieldName = fieldSelector ? fieldSelector.split(".").slice(1).join(".") || fieldSelector : fieldName;
  const requestedEntityName = fieldSelector ? fieldSelector.split(".")[0] : entitySelector || traceValue || entityName;
  const entity = { id: `entity:${requestedEntityName}`, name: requestedEntityName };
  const field = { id: `field:${requestedEntityName}.${requestedFieldName}`, name: requestedFieldName, typeText: "string", optional: false };
  if (traceIndex >= 0 && fieldSelector) {
    console.log(
      JSON.stringify({
        status: "ok",
        mode: "trace-field",
        entity,
        field,
        lineageNodeCount: 1,
        lineageEdgeCount: 0,
        warningCount: 0,
        lineage: {
          nodes: [
            {
              id: `lineage:${field.id}`,
              kind: "data-field",
              label: `${requestedEntityName}.${requestedFieldName}`,
              confidence: "explicit",
              dataModelEntityId: entity.id,
              dataModelFieldId: field.id,
              evidenceRefs: sourceRefs,
              warnings: []
            }
          ],
          edges: []
        },
        warnings: []
      })
    );
  } else if (traceIndex >= 0) {
    console.log(
      JSON.stringify({
        status: "ok",
        mode: "trace-entity",
        entity,
        lineageNodeCount: 1,
        lineageEdgeCount: 0,
        warningCount: 0,
        lineage: {
          nodes: [
            {
              id: `lineage:${entity.id}`,
              kind: "data-entity",
              label: requestedEntityName,
              confidence: "explicit",
              dataModelEntityId: entity.id,
              evidenceRefs: sourceRefs,
              warnings: []
            }
          ],
          edges: []
        },
        warnings: []
      })
    );
  } else if (fieldSelector) {
    console.log(JSON.stringify({ status: "ok", mode: "field", entity, field, sourceRefs, warnings: [] }));
  } else if (entitySelector) {
    console.log(
      JSON.stringify({
        status: "ok",
        mode: "entity",
        entity: { ...entity, fields: [{ id: `field:${requestedEntityName}.${fieldName}`, name: fieldName, typeText: "string", optional: false }], sourceRefs },
        sourceRefs,
        warnings: []
      })
    );
  } else {
    const index = value("--index");
    fs.mkdirSync(index, { recursive: true });
    const summary = { entityCount: 1, relationshipCount: 0, warningCount: 0 };
    fs.writeFileSync(
      path.join(index, "data-model.json"),
      JSON.stringify({
        artifactKind: "my-dev-kit-v1-data-model",
        schemaVersion: "1.1.0",
        createdAt,
        entities: [{ id: entityId, name: entityName, fields: [{ id: fieldId, name: fieldName, typeText: "string", optional: false }], sourceRefs }],
        relationships: [],
        warnings: [],
        summary
      })
    );
    fs.writeFileSync(
      path.join(index, "data-model-graph.json"),
      JSON.stringify({
        artifactKind: "my-dev-kit-v1-data-model-graph",
        schemaVersion: "1.1.0",
        createdAt,
        nodes: [
          { id: entityId, kind: "entity", label: entityName, sourceRefs },
          { id: fieldId, kind: "field", label: `${entityName}.${fieldName}`, sourceRefs }
        ],
        edges: [{ id: `edge:${entityId}->${fieldId}`, kind: "has-field", from: entityId, to: fieldId }],
        warnings: [],
        summary: { nodeCount: 2, edgeCount: 1, warningCount: 0 }
      })
    );
    console.log(JSON.stringify({ status: "ok", mode: "generate", artifacts: ["data-model.json", "data-model-graph.json"], summary, warnings: [] }));
  }
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
