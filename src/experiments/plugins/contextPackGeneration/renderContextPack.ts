import type {
  ContextPackCallRelationship,
  ContextPackEvidenceNoteCode,
  ContextPackFile,
  ContextPackSectionAvailabilityInput,
  ContextPackSectionId,
  ContextPackSourceSlice,
  ContextPackSymbol,
  ContextPackTask,
  ContextPackTest
} from "./types.js";

/** Stable source boundary; it cannot be confused with Markdown code-fence nesting. */
export const CONTEXT_PACK_SOURCE_BEGIN = "<<<SOURCE";
export const CONTEXT_PACK_SOURCE_END = "SOURCE>>>";

export const CONTEXT_PACK_SECTION_HEADINGS: Record<ContextPackSectionId, string> = {
  task: "## Task",
  files: "## Relevant files",
  symbols: "## Relevant symbols",
  sourceSlices: "## Source slices",
  callRelationships: "## Call relationships",
  tests: "## Tests",
  evidenceNotes: "## Evidence notes"
};

export type ContextPackRenderInput = {
  task: ContextPackTask;
  files: readonly ContextPackFile[];
  symbols: readonly ContextPackSymbol[];
  sourceSlices: readonly ContextPackSourceSlice[];
  callRelationships: readonly ContextPackCallRelationship[];
  tests: readonly ContextPackTest[];
  evidenceNotes: readonly ContextPackEvidenceNoteCode[];
  /** Used only to distinguish an empty available section from a partial or unavailable one. */
  sectionAvailability: Record<ContextPackSectionId, ContextPackSectionAvailabilityInput>;
};

export type RenderedContextPack = {
  /** One exact rendered string per section, in fixed section order, without trailing newline. */
  sections: Record<ContextPackSectionId, string>;
  /** Sections joined by exactly one blank line, ending with exactly one newline. LF only. */
  renderedText: string;
};

const lf = (text: string): string => text.replace(/\r\n?/g, "\n");

function renderBody(
  id: ContextPackSectionId,
  lines: readonly string[],
  availability: Record<ContextPackSectionId, ContextPackSectionAvailabilityInput>
): string {
  const heading = CONTEXT_PACK_SECTION_HEADINGS[id];
  if (lines.length > 0) return [heading, ...lines].join("\n");
  const { availability: state, reason } = availability[id];
  const suffix = reason === null ? "" : `: ${reason}`;
  const placeholder = state === "available" ? "(none)" : `(${state}${suffix})`;
  return `${heading}\n${placeholder}`;
}

function renderSlice(slice: ContextPackSourceSlice): string {
  return [
    `file: ${slice.file}`,
    `lines: ${slice.startLine}-${slice.endLine}`,
    `boundary: ${slice.boundaryKnown ? "known" : "unknown"}`,
    `truncated: ${slice.truncated ? "yes" : "no"}`,
    CONTEXT_PACK_SOURCE_BEGIN,
    lf(slice.text),
    CONTEXT_PACK_SOURCE_END
  ].join("\n");
}

/** Deterministic, language-agnostic rendering. Source text is verbatim apart from line-ending normalization. */
export function renderContextPack(input: ContextPackRenderInput): RenderedContextPack {
  const availability = input.sectionAvailability;
  const sections: Record<ContextPackSectionId, string> = {
    task: `${CONTEXT_PACK_SECTION_HEADINGS.task}\nTitle: ${lf(input.task.title)}\nSummary: ${lf(input.task.summary)}`,
    files: renderBody("files", input.files.map((file) => `- ${file.path}`), availability),
    symbols: renderBody(
      "symbols",
      input.symbols.map((symbol) => (symbol.file === null ? `- ${symbol.name}` : `- ${symbol.name} (${symbol.file})`)),
      availability
    ),
    sourceSlices: renderSourceSlices(input.sourceSlices, availability),
    callRelationships: renderBody(
      "callRelationships",
      input.callRelationships.map((call) => `${call.fromNodeId} -> ${call.toNodeId}`),
      availability
    ),
    tests: renderBody("tests", input.tests.map((test) => `- ${test.path}`), availability),
    evidenceNotes: renderBody("evidenceNotes", input.evidenceNotes.map((code) => `- ${code}`), availability)
  };
  const renderedText = `${[
    sections.task,
    sections.files,
    sections.symbols,
    sections.sourceSlices,
    sections.callRelationships,
    sections.tests,
    sections.evidenceNotes
  ].join("\n\n")}\n`;
  return { sections, renderedText };
}

function renderSourceSlices(
  slices: readonly ContextPackSourceSlice[],
  availability: Record<ContextPackSectionId, ContextPackSectionAvailabilityInput>
): string {
  if (slices.length === 0) return renderBody("sourceSlices", [], availability);
  return `${CONTEXT_PACK_SECTION_HEADINGS.sourceSlices}\n${slices.map(renderSlice).join("\n\n")}`;
}
