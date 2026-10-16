// Context-correct HTML helpers for the generic static report. Text escaping and link validation are separate
// concerns: escaping alone never makes a URL safe, so every emitted href is validated here independently.

export function escapeHtml(value: string | number | boolean | null | undefined): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

const SAFE_ANCHOR_ID = /^[a-z][a-z0-9-]{0,127}$/;

/** True only for a plain lowercase in-document anchor id that this renderer generated. */
export function isSafeAnchorId(value: unknown): value is string {
  return typeof value === "string" && SAFE_ANCHOR_ID.test(value);
}

/**
 * Returns an href that is safe to emit, or null. Only in-document fragment links to a safe anchor id are
 * permitted: no scheme-bearing URL (javascript:, data:, file:, http:, ...) and no filesystem path is ever linked.
 */
export function safeInternalHref(value: unknown): string | null {
  if (typeof value !== "string" || !value.startsWith("#")) return null;
  return isSafeAnchorId(value.slice(1)) ? value : null;
}

/** Derives a safe, lowercase section anchor id from a registry/descriptor identifier. */
export function sectionAnchorId(identifier: string): string {
  const slug = identifier
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `section-${slug || "unnamed"}`;
}
