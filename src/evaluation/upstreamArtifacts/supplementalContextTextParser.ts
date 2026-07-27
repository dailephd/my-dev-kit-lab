// Deterministic line-based parser for the frozen my-dev-kit-orchestrator supplemental
// repository-context document format (commit bc08a05d3b52a629e7e4504372af199c324c4ae4,
// src/instructions/supplementalContextParser.ts): "Key: value" metadata lines before the
// first "## " heading, then "## Heading" sections running to the next heading or EOF.
// Independently re-derived from the frozen contract for the lab's own read-only boundary;
// never imports orchestrator runtime code. Structural classification only -- never
// evaluates whether a declared value is true.

const METADATA_LINE_RE = /^([A-Za-z][A-Za-z0-9 -]*): (.*)$/;
const SECTION_HEADING_RE = /^## (.+)$/;

export interface ParsedSupplementalContextText {
  metadata: Record<string, string>;
  metadataOrder: string[];
  sections: Record<string, string>;
  sectionOrder: string[];
  duplicateMetadataKeys: string[];
  emptyMetadataKeys: string[];
  duplicateSectionHeadings: string[];
}

export function parseSupplementalContextText(text: string): ParsedSupplementalContextText {
  const lines = text.split(/\r\n|\n/);

  const metadata: Record<string, string> = {};
  const metadataOrder: string[] = [];
  const duplicateMetadataKeys: string[] = [];
  const emptyMetadataKeys: string[] = [];

  let i = 0;
  for (; i < lines.length; i++) {
    const line = lines[i];
    if (SECTION_HEADING_RE.test(line)) break;
    const match = line.match(METADATA_LINE_RE);
    if (!match) continue;
    const key = match[1];
    const value = match[2].trim();
    if (Object.prototype.hasOwnProperty.call(metadata, key)) {
      duplicateMetadataKeys.push(key);
      continue;
    }
    if (value.length === 0) {
      emptyMetadataKeys.push(key);
    }
    metadata[key] = value;
    metadataOrder.push(key);
  }

  const sections: Record<string, string> = {};
  const sectionOrder: string[] = [];
  const duplicateSectionHeadings: string[] = [];

  let currentHeading: string | null = null;
  let currentLines: string[] = [];
  const flush = () => {
    if (currentHeading === null) return;
    const content = currentLines.join("\n").trim();
    if (Object.prototype.hasOwnProperty.call(sections, currentHeading)) {
      duplicateSectionHeadings.push(currentHeading);
    } else {
      sections[currentHeading] = content;
      sectionOrder.push(currentHeading);
    }
  };
  for (; i < lines.length; i++) {
    const line = lines[i];
    const headingMatch = line.match(SECTION_HEADING_RE);
    if (headingMatch) {
      flush();
      currentHeading = headingMatch[1].trim();
      currentLines = [];
    } else if (currentHeading !== null) {
      currentLines.push(line);
    }
  }
  flush();

  return {
    metadata,
    metadataOrder,
    sections,
    sectionOrder,
    duplicateMetadataKeys,
    emptyMetadataKeys,
    duplicateSectionHeadings
  };
}
