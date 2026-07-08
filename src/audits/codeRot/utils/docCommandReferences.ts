import { splitLines } from "./textLines.js";

// ---------------------------------------------------------------------------
// v0.3.0 Batch 3 — shared doc-text scanning helper.
//
// Deterministic, regex-based extraction of "npm run <script>" references
// from documentation text, with a bounded-window heuristic for whether the
// reference is clearly labeled as planned/future rather than current. Used
// by staleCommandReferenceDetector.ts (and available to other detectors) so
// this scanning logic exists exactly once.
// ---------------------------------------------------------------------------

export type DocCommandReference = {
  command: string;
  lineNumber: number;
  excerpt: string;
  isLabeledPlanned: boolean;
};

// Skips optional leading "npm run" flags (e.g. "npm run --silent <script>")
// before capturing the actual script name -- without this, "--silent" itself
// gets captured as if it were the script name.
const NPM_RUN_PATTERN = /npm run (?:--\S+\s+)*([\w:.-]+)/g;

// Cues that mark a nearby command reference as planned/future/intentionally-
// unimplemented rather than a current, working example. Deliberately
// conservative wording match (whole word/phrase), not broad semantic
// inference. "avoid" covers this project's own "commands to avoid unless
// truly necessary" roadmap convention for commands that are deliberately
// never meant to exist.
const PLANNED_LABEL_PATTERN =
  /\b(planned|future|roadmap|not implemented|not yet implemented|later version|coming soon|avoid)\b/i;

// How many lines above the reference line to include when checking for a
// planned-label cue, in addition to the enclosing-heading check below.
// Covers a preceding sentence or list-intro line that isn't itself a
// markdown heading (e.g. "Commands to avoid unless truly necessary:") and
// may be more than a few lines above the last item in a long bullet list.
const PLANNED_LABEL_WINDOW_LINES = 15;

const HEADING_PATTERN = /^(#{1,6})\s+(.*)$/;

export function extractDocCommandReferences(content: string): DocCommandReference[] {
  const lines = splitLines(content);
  const refs: DocCommandReference[] = [];
  const seenOnLine = new Set<string>();

  // Tracks the most recently seen heading text at each markdown heading
  // depth (1-6) as we scan top to bottom. A reference nested arbitrarily
  // deep under a "## Planned ..." section inherits that section's framing
  // even when the nearest local text (a sibling "### v0.4.0 ..." heading,
  // say) doesn't itself contain a planned-label word -- this is what makes
  // the check robust to roadmap documents with many nested version
  // subsections, without an unbounded backward text scan.
  const headingStack: (string | undefined)[] = new Array(7).fill(undefined);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    const headingMatch = line.match(HEADING_PATTERN);
    if (headingMatch) {
      const depth = headingMatch[1].length;
      headingStack[depth] = headingMatch[2];
      // A new heading at depth N implicitly starts a fresh subsection for
      // every deeper level -- clear them so a later, unrelated deep
      // heading under a different parent doesn't leak stale context.
      for (let d = depth + 1; d < headingStack.length; d++) headingStack[d] = undefined;
    }

    NPM_RUN_PATTERN.lastIndex = 0;
    for (const match of line.matchAll(NPM_RUN_PATTERN)) {
      const command = match[1];
      const key = `${i}:${command}`;
      if (seenOnLine.has(key)) continue;
      seenOnLine.add(key);

      const windowStart = Math.max(0, i - PLANNED_LABEL_WINDOW_LINES);
      const localWindow = lines.slice(windowStart, i + 1).join(" ");
      const headingContext = headingStack.filter((h): h is string => h !== undefined).join(" ");
      const combined = `${headingContext} ${localWindow}`;

      refs.push({
        command,
        lineNumber: i + 1,
        excerpt: line.trim().slice(0, 200),
        isLabeledPlanned: PLANNED_LABEL_PATTERN.test(combined),
      });
    }
  }

  return refs;
}
