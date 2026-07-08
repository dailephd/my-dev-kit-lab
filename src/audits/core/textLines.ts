// ---------------------------------------------------------------------------
// v0.3.0 Batch 6 — canonical, core-level line-splitting helper.
//
// Moved here from src/audits/codeRot/utils/textLines.ts (Batch 3), because
// src/audits/core/sourceOfTruth.ts (a core-level module) needed the same
// CRLF-safe splitting behavior for parseNodeVersions()'s list-form
// "node-version:\n  - 20\n  - 22" parsing, and core/ depending on
// codeRot/utils/ would be architecturally backwards (core is lower-level
// than codeRot). This is now the single canonical implementation; the
// codeRot-side module re-exports it so no existing detector import path
// changes (see src/audits/codeRot/utils/textLines.ts).
//
// Windows-authored files in this repo (e.g. docs/ROADMAP.md) commonly have
// CRLF line endings. A plain content.split("\n") leaves a trailing "\r" on
// every line, which silently breaks any "$"-anchored regex against that
// line (JS regex "." does not match "\r", a line terminator character) --
// discovered via a real false negative where a heading-tracking regex
// matched zero headings in a CRLF file. Every module that splits doc/text
// content into lines must go through this helper instead of a bare
// .split("\n").
// ---------------------------------------------------------------------------

export function splitLines(content: string): string[] {
  return content.replace(/\r\n/g, "\n").split("\n");
}
