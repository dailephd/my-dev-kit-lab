// Lab-owned fixture builder for the frozen my-dev-kit-orchestrator supplemental
// repository-context document format (commit bc08a05d3b52a629e7e4504372af199c324c4ae4).
// No static real-world example of a *populated* plain-text packet/report is checked
// into the frozen orchestrator commit -- orchestrator's own tests synthesize one at
// test-time from `writeSupplementalContextTemplates()` + section substitution
// (tests/readyContextTestHelpers.ts). This builder does the same thing independently,
// from the frozen structural contract (REQUIRED_METADATA_BY_DOCUMENT_KIND /
// REQUIRED_SECTIONS_BY_DOCUMENT_KIND, restated in
// src/evaluation/upstreamArtifacts/supplementalContextTypes.ts), so tests can construct
// valid documents and then remove/corrupt one known field at a time.
import {
  REQUIRED_METADATA_BY_DOCUMENT_KIND,
  REQUIRED_SECTIONS_BY_DOCUMENT_KIND,
  ROLE_BY_DOCUMENT_KIND,
  isRetrievalReportKind,
  isTestKind,
  type SupplementalContextDocumentKind
} from "../../../src/evaluation/upstreamArtifacts/supplementalContextTypes.js";

const DEFAULT_METADATA_VALUES: Record<string, string> = {
  "Schema version": "1.0.0",
  Role: "",
  Status: "populated",
  "Repository scope": "single-repository",
  Freshness: "fresh",
  Adequacy: "sufficient",
  "Required evidence truncated": "no",
  "Context capsule schema version": "1.0.0",
  "Retrieval audit schema version": "1.0.0",
  "Tool name": "my-dev-kit",
  "Tool version": "1.10.2",
  "Index identity": "Z:/Users/newuser/Projects/fixture-repo",
  "Request schema version": "1.0.0",
  "Full-file fallback used": "no",
  "Determinism checked": "yes",
  "Responsibility mappings truncated": "no",
  "Critical responsibility mapping status": "mapped"
};

export function buildValidSupplementalContextText(
  kind: SupplementalContextDocumentKind,
  overrides: {
    metadata?: Record<string, string | undefined>;
    sections?: Record<string, string | undefined>;
    extraMetadataLines?: string[];
    extraSections?: Record<string, string>;
  } = {}
): string {
  const requiredMetadata = REQUIRED_METADATA_BY_DOCUMENT_KIND[kind];
  const requiredSections = REQUIRED_SECTIONS_BY_DOCUMENT_KIND[kind];
  const role = ROLE_BY_DOCUMENT_KIND[kind];

  const metadataLines: string[] = [];
  for (const key of requiredMetadata) {
    if (overrides.metadata && key in overrides.metadata) {
      const value = overrides.metadata[key];
      if (value === undefined) continue; // omit this required key entirely
      metadataLines.push(`${key}: ${value}`);
      continue;
    }
    const value = key === "Document kind" ? kind : key === "Role" ? role : DEFAULT_METADATA_VALUES[key];
    metadataLines.push(`${key}: ${value ?? "unknown"}`);
  }
  // "Document kind" isn't in DEFAULT_METADATA_VALUES/requiredMetadata iteration above unless present;
  // required metadata lists always include it, handled by the key === "Document kind" branch.
  if (overrides.extraMetadataLines) metadataLines.push(...overrides.extraMetadataLines);

  const sectionLines: string[] = [];
  for (const heading of requiredSections) {
    if (overrides.sections && heading in overrides.sections) {
      const value = overrides.sections[heading];
      if (value === undefined) continue; // omit this required section entirely
      sectionLines.push(`## ${heading}`, value, "");
      continue;
    }
    sectionLines.push(`## ${heading}`, `Fixture evidence for "${heading}".`, "");
  }
  if (overrides.extraSections) {
    for (const [heading, value] of Object.entries(overrides.extraSections)) {
      sectionLines.push(`## ${heading}`, value, "");
    }
  }

  return [...metadataLines, "", ...sectionLines].join("\n").trimEnd() + "\n";
}

export function kindsToExercise(): SupplementalContextDocumentKind[] {
  return [
    "implementation-context-packet",
    "implementation-context-retrieval-report",
    "test-context-packet",
    "test-context-retrieval-report"
  ];
}

export { isRetrievalReportKind, isTestKind };
