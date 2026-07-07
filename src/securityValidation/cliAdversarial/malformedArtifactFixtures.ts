import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

// ---------------------------------------------------------------------------
// Malformed artifact content constants
// ---------------------------------------------------------------------------

export type MalformedArtifactCase = {
  id: string;
  description: string;
  content: string;
};

export const MALFORMED_MANIFEST_CASES: MalformedArtifactCase[] = [
  {
    id: "truncated-json",
    description: "Truncated JSON (no closing brace)",
    content: "{",
  },
  {
    id: "null-value",
    description: "JSON null at root",
    content: "null",
  },
  {
    id: "wrong-type-array",
    description: "Array instead of object",
    content: "[]",
  },
  {
    id: "missing-version",
    description: "Object missing schemaVersion field",
    content: JSON.stringify({ root: ".", files: [] }),
  },
  {
    id: "not-json",
    description: "Not valid JSON",
    content: "this is not json at all",
  },
];

export const MALFORMED_CODE_GRAPH_CASES: MalformedArtifactCase[] = [
  {
    id: "null-nodes",
    description: "nodes array is null",
    content: JSON.stringify({ schemaVersion: 1, nodes: null, edges: [] }),
  },
  {
    id: "empty-object",
    description: "Empty object",
    content: "{}",
  },
  {
    id: "truncated-json",
    description: "Truncated JSON array",
    content: '{"nodes": [{"id"',
  },
];

export const UNSUPPORTED_SCHEMA_VERSION_CASES: MalformedArtifactCase[] = [
  {
    id: "future-version",
    description: "Schema version far in the future",
    content: JSON.stringify({ schemaVersion: 9999, root: ".", files: [] }),
  },
  {
    id: "string-version",
    description: "Schema version as a string instead of number",
    content: JSON.stringify({ schemaVersion: "future", root: ".", files: [] }),
  },
  {
    id: "negative-version",
    description: "Negative schema version",
    content: JSON.stringify({ schemaVersion: -1, root: ".", files: [] }),
  },
];

// ---------------------------------------------------------------------------
// Fixture placement helpers
// ---------------------------------------------------------------------------

export function placeMalformedArtifact(
  dir: string,
  filename: string,
  content: string
): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, filename), content, "utf8");
}

export function placeMalformedManifest(dir: string, content: string): void {
  placeMalformedArtifact(dir, "manifest.json", content);
}

export function placeMalformedCodeGraph(dir: string, content: string): void {
  placeMalformedArtifact(dir, "code-graph.json", content);
}

export function placeUnsupportedSchemaManifest(dir: string, content: string): void {
  placeMalformedArtifact(dir, "manifest.json", content);
}
