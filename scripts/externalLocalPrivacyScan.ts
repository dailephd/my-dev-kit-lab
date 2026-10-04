import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

/**
 * Single owner for scanning the DURABLE output of an external-local context-window run for private values
 * (machine paths, private source markers, excluded file names). It is shared by the vitest suite and by the
 * packed-package verifier (compiled to dist/scripts), so both prove the same privacy contract.
 *
 * Only encodings the current artifact writers can actually produce are checked: the raw value, both path
 * separator styles, the JSON string-escaped form (a Windows backslash is serialized as two backslashes), and the
 * HTML-escaped form used by report.html. No writer emits file:// URLs or percent-encoded paths.
 */

export type PrivacySentinelKind = "path" | "text";

export type PrivacySentinel = { label: string; value: string; kind: PrivacySentinelKind };

export type PrivacyLeak = { artifact: string; label: string; form: string };

const JSON_ESCAPE = (value: string): string => JSON.stringify(value).slice(1, -1);

const HTML_ESCAPE = (value: string): string =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

/** Every representation of one sentinel a durable artifact could contain. Order is deterministic. */
export function privacyForms(sentinel: PrivacySentinel): { form: string; text: string }[] {
  const bases: { form: string; text: string }[] = [{ form: "raw", text: sentinel.value }];
  if (sentinel.kind === "path") {
    bases.push({ form: "forward-slash", text: sentinel.value.replace(/\\/g, "/") });
    bases.push({ form: "backslash", text: sentinel.value.replace(/\//g, "\\") });
  }
  const forms: { form: string; text: string }[] = [];
  const seen = new Set<string>();
  const add = (form: string, text: string): void => {
    if (text.length === 0 || seen.has(text)) return;
    seen.add(text);
    forms.push({ form, text });
  };
  for (const base of bases) add(base.form, base.text);
  for (const base of bases) add(`json-escaped ${base.form}`, JSON_ESCAPE(base.text));
  for (const base of bases) add(`html-escaped ${base.form}`, HTML_ESCAPE(base.text));
  return forms;
}

/**
 * Scans named text artifacts (and the artifact names themselves) for every form of every sentinel. Path
 * sentinels are compared case-insensitively because drive-letter and directory casing are not stable on
 * case-insensitive filesystems.
 */
export function scanDurableArtifactText(artifacts: readonly { name: string; text: string }[], sentinels: readonly PrivacySentinel[]): PrivacyLeak[] {
  const leaks: PrivacyLeak[] = [];
  for (const sentinel of sentinels) {
    const forms = privacyForms(sentinel);
    for (const artifact of artifacts) {
      for (const candidate of [{ where: artifact.name, haystack: artifact.name }, { where: artifact.name, haystack: artifact.text }]) {
        const haystack = sentinel.kind === "path" ? candidate.haystack.toLowerCase() : candidate.haystack;
        const hit = forms.find((form) => haystack.includes(sentinel.kind === "path" ? form.text.toLowerCase() : form.text));
        if (hit) {
          leaks.push({ artifact: candidate.where, label: sentinel.label, form: hit.form });
          break;
        }
      }
    }
  }
  return leaks;
}

/** Lists every regular file below a directory as forward-slash relative names, sorted. */
export function listDurableFiles(directory: string): string[] {
  const found: string[] = [];
  const walk = (current: string, prefix: string): void => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const relative = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
      if (entry.isDirectory()) walk(path.join(current, entry.name), relative);
      else found.push(relative);
    }
  };
  walk(directory, "");
  return found.sort();
}

/** Scans every file under an output directory, including names, for private values. */
export function scanDurableOutputDirectory(directory: string, sentinels: readonly PrivacySentinel[]): PrivacyLeak[] {
  const artifacts = listDurableFiles(directory).map((name) => ({ name, text: readFileSync(path.join(directory, ...name.split("/")), "utf8") }));
  return scanDurableArtifactText(artifacts, sentinels);
}

const PLACEHOLDER = /^<redacted file (\d+)>$/;

function placeholderProblems(list: unknown, at: string): string[] {
  if (!Array.isArray(list)) return [`${at} is not a list`];
  const problems: string[] = [];
  list.forEach((entry, index) => {
    const match = typeof entry === "string" ? PLACEHOLDER.exec(entry) : null;
    if (!match || Number(match[1]) !== index + 1) problems.push(`${at}[${index}] is not <redacted file ${index + 1}>`);
  });
  return problems;
}

/**
 * Checks that the redaction of an external-local execution artifact stays truthful: every file identity is a
 * numbered placeholder, list lengths equal the exact counts (so [] still means "no files" and null still means
 * "unavailable"), and each treatment carries the machine-readable fileIdentityRedaction marker.
 */
export function checkRedactionTruthfulness(artifact: unknown): string[] {
  const cases = (artifact as { cases?: unknown })?.cases;
  if (!Array.isArray(cases) || cases.length === 0) return ["artifact has no cases"];
  const problems: string[] = [];
  cases.forEach((caseEvidence: any, caseIndex: number) => {
    for (const treatment of caseEvidence?.treatments ?? []) {
      const at = `cases[${caseIndex}].${treatment?.variantId}`;
      if (treatment?.fileIdentityRedaction !== "redacted") problems.push(`${at} lacks fileIdentityRedaction "redacted"`);
      const observed = treatment?.context?.observedFiles;
      if (observed !== null) problems.push(...placeholderProblems(observed, `${at}.context.observedFiles`));
      const relevant = treatment?.relevantFileEvidence ?? {};
      problems.push(...placeholderProblems(relevant.expectedRelevantFiles, `${at}.expectedRelevantFiles`));
      problems.push(...placeholderProblems(relevant.omittedRelevantFiles, `${at}.omittedRelevantFiles`));
      if (Array.isArray(relevant.expectedRelevantFiles) && relevant.expectedRelevantFiles.length !== relevant.expectedRelevantFileCount) {
        problems.push(`${at}.expectedRelevantFiles length differs from expectedRelevantFileCount`);
      }
      if (Array.isArray(relevant.omittedRelevantFiles) && relevant.omittedRelevantFiles.length !== (relevant.omittedRelevantFileCount ?? 0)) {
        problems.push(`${at}.omittedRelevantFiles length differs from omittedRelevantFileCount`);
      }
    }
  });
  return problems;
}
