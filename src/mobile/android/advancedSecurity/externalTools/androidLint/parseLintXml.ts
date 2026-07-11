import { parseXmlDocument, findChildren, type XmlElement } from "../../../manifest/xml/parseXml.js";
import { DEFAULT_MAX_MESSAGE_LENGTH } from "../boundedOutput.js";

// ---------------------------------------------------------------------------
// v0.4.1 Batch 7 — bounded Android Lint XML report parsing.
//
// Reuses the existing generic XML parser (src/mobile/android/manifest/xml/
// parseXml.ts, already used for Network Security Config and FileProvider
// paths XML) rather than a second XML parser. Lint XML attributes are not
// namespaced (unlike AndroidManifest.xml's android: attributes), so a local
// namespace-free attribute lookup is used instead of getAttribute's
// Android-namespace default.
// ---------------------------------------------------------------------------

export type LintXmlIssue = {
  id: string;
  severity: string;
  message: string;
  category?: string;
  priority?: string;
  file?: string;
  line?: number;
  column?: number;
};

export type ParseLintXmlResult = { malformed: boolean; issues: LintXmlIssue[]; formatVersion?: string };

function attr(element: XmlElement, name: string): string | undefined {
  return element.attributes.find((a) => a.localName === name)?.value;
}

function boundedMessage(text: string | undefined): string {
  if (!text) return "";
  return text.length > DEFAULT_MAX_MESSAGE_LENGTH ? `${text.slice(0, DEFAULT_MAX_MESSAGE_LENGTH)}...` : text;
}

export function parseLintXml(xmlText: string): ParseLintXmlResult {
  const parsed = parseXmlDocument(xmlText);
  if (!parsed.ok) return { malformed: true, issues: [] };

  const root = parsed.root;
  if (root.localName !== "issues") return { malformed: true, issues: [] };

  const issues: LintXmlIssue[] = [];
  for (const issueElement of findChildren(root, "issue")) {
    const locations = findChildren(issueElement, "location");
    const primaryLocation = locations[0];
    const lineRaw = primaryLocation ? attr(primaryLocation, "line") : undefined;
    const columnRaw = primaryLocation ? attr(primaryLocation, "column") : undefined;

    issues.push({
      id: attr(issueElement, "id") ?? "(unknown-issue)",
      severity: attr(issueElement, "severity") ?? "(unknown)",
      message: boundedMessage(attr(issueElement, "message") ?? attr(issueElement, "summary")),
      category: attr(issueElement, "category"),
      priority: attr(issueElement, "priority"),
      file: primaryLocation ? attr(primaryLocation, "file") : undefined,
      line: lineRaw ? Number.parseInt(lineRaw, 10) : undefined,
      column: columnRaw ? Number.parseInt(columnRaw, 10) : undefined,
    });
  }

  return { malformed: false, issues, formatVersion: attr(root, "format") };
}
