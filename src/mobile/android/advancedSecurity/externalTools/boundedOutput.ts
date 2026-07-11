// ---------------------------------------------------------------------------
// v0.4.1 Batch 7 — bounded text/JSON handling for external-tool output.
//
// No shared "safe JSON parse" utility existed before this batch (each
// consumer, e.g. src/securityValidation/staticScans/semgrep.ts, inlines its
// own unbounded try/catch JSON.parse). This module is the one owner Batch 7
// adapters share — a truncated document is never handed to JSON.parse, since
// a truncated-but-syntactically-valid-looking prefix could otherwise parse
// successfully into a wrong/partial value instead of failing loudly.
// ---------------------------------------------------------------------------

export const DEFAULT_MAX_STDOUT_BYTES = 16 * 1024 * 1024;
export const DEFAULT_MAX_STDERR_BYTES = 2 * 1024 * 1024;
export const DEFAULT_MAX_REPORT_BYTES = 32 * 1024 * 1024;
export const DEFAULT_MAX_MESSAGE_LENGTH = 1_000;
export const DEFAULT_MAX_SNIPPET_LENGTH = 240;

export function boundedText(text: string, maxLength: number): { text: string; truncated: boolean } {
  if (text.length <= maxLength) return { text, truncated: false };
  return { text: text.slice(0, maxLength), truncated: true };
}

export type SafeJsonParseResult<T> = { ok: true; value: T; truncated: boolean } | { ok: false; malformed: true; truncated: boolean };

// Bounds the input length BEFORE parsing (a truncated document is reported
// malformed/truncated, never parsed as if it were a smaller valid document).
export function safeJsonParse<T = unknown>(text: string, maxBytes: number = DEFAULT_MAX_REPORT_BYTES): SafeJsonParseResult<T> {
  const truncated = text.length > maxBytes;
  if (truncated) return { ok: false, malformed: true, truncated: true };
  try {
    return { ok: true, value: JSON.parse(text) as T, truncated: false };
  } catch {
    return { ok: false, malformed: true, truncated: false };
  }
}
