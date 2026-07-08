// ---------------------------------------------------------------------------
// v0.3.0 Batch 3 (moved in Batch 6) — shared line-splitting helper.
//
// The canonical implementation now lives in src/audits/core/textLines.ts
// (core is lower-level than codeRot, and src/audits/core/sourceOfTruth.ts
// needed the same helper -- see that file's header comment). This module is
// kept as a transparent re-export so every existing codeRot detector/util
// that imports `splitLines` from "../utils/textLines.js" (or
// "./textLines.js") keeps working unchanged -- named-export re-exports are
// transparent to importers, there is no behavior difference.
// ---------------------------------------------------------------------------

export { splitLines } from "../../core/textLines.js";
