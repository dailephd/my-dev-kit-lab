import type { SecurityFinding } from "../../../securityValidation/types.js";
import type { AndroidDetectionResult } from "../detection.js";
import type { AndroidIntentFilter, AndroidIntentFilterData, AndroidManifestComponent, AndroidManifestComponentKind } from "../manifest/types.js";
import type { AndroidManifestParseEntry } from "../manifest/parseAndroidManifest.js";
import type { AndroidCheckResult } from "../validation/checkResult.js";
import { makeAndroidFinding } from "./androidFinding.js";
import { buildAndroidManifestCheckResult } from "./checkResultBuilder.js";

// ---------------------------------------------------------------------------
// v0.4.0 Batch 3 — initial deep-link audit.
//
// Distinguishes web links (http/https) from custom-scheme deep links, flags
// missing host/scheme restrictions and broad path patterns, and treats
// BROWSABLE-without-VIEW and VIEW-without-BROWSABLE as separate "incomplete
// filter" observations (agents.txt Batch 3 section 7.16). Never claims
// Digital Asset Links verification, domain ownership, or exploitability —
// findings are framed as static exposure/configuration review, at most
// "major" for the narrow high-confidence case of an explicitly exported,
// unprotected, wildcard-path activity.
// ---------------------------------------------------------------------------

const VIEW_ACTION = "android.intent.action.VIEW";
const BROWSABLE_CATEGORY = "android.intent.category.BROWSABLE";
const WILDCARD_PATTERN = /[*.]{1,2}\*|\.\*/;

function isPlaceholder(value: string | undefined): boolean {
  return value !== undefined && (value.includes("${") || value.startsWith("@"));
}

function classifyScheme(dataElements: AndroidIntentFilterData[]): "web" | "custom" | "none" {
  const schemes = dataElements.map((d) => d.dataScheme).filter((s): s is string => Boolean(s));
  if (schemes.length === 0) return "none";
  if (schemes.some((s) => s === "http" || s === "https")) return "web";
  return "custom";
}

function auditDeepLinkFilter(
  entry: AndroidManifestParseEntry,
  kind: AndroidManifestComponentKind,
  component: AndroidManifestComponent,
  filter: AndroidIntentFilter,
  findings: SecurityFinding[]
): void {
  const identity = component.name || "(unnamed component)";
  const actions = filter.actions ?? [];
  const categories = filter.categories ?? [];
  const dataElements = filter.dataElements ?? filter.filterData;
  const hasView = actions.includes(VIEW_ACTION);
  const hasBrowsable = categories.includes(BROWSABLE_CATEGORY);

  if (!hasView && !hasBrowsable) return;

  if (hasBrowsable && !hasView) {
    findings.push(
      makeAndroidFinding({
        ruleId: "android-deep-link-browsable-without-view",
        title: `BROWSABLE category without a VIEW action on ${kind} "${identity}"`,
        severity: "informational",
        confidence: "high",
        description: "This <intent-filter> declares category BROWSABLE without action VIEW, so it will not actually be treated as a browsable web/deep link by the platform.",
        manifestPath: entry.manifestPath,
        identity,
        location: filter.location,
      })
    );
    return;
  }

  if (hasView && !hasBrowsable && dataElements.length === 0) {
    // Plain VIEW with no data and no BROWSABLE — not a deep link, nothing to audit here.
    return;
  }

  const exportedExplicitTrue = component.exported === true;
  const unprotected = !component.permission;
  const scheme = classifyScheme(dataElements);
  const hasHost = dataElements.some((d) => Boolean(d.dataHost));
  const placeholderEvidence = dataElements.some(
    (d) => isPlaceholder(d.dataScheme) || isPlaceholder(d.dataHost) || isPlaceholder(d.dataPath) || isPlaceholder(d.dataPathPrefix) || isPlaceholder(d.dataPathPattern)
  );
  const broadPattern = dataElements.some((d) => (d.dataPathPattern && WILDCARD_PATTERN.test(d.dataPathPattern)) || d.dataPathPattern === ".*" || d.dataPathPattern === "*");

  const evidenceDetails = [
    `scheme=${scheme}`,
    `hasHost=${hasHost}`,
    `exported=${component.exported ?? "unspecified"}`,
    `hasComponentPermission=${!unprotected}`,
    `dataElementCount=${dataElements.length}`,
  ];

  if (placeholderEvidence) {
    findings.push(
      makeAndroidFinding({
        ruleId: "android-deep-link-placeholder-value",
        title: `Deep-link data on ${kind} "${identity}" contains an unresolved placeholder or resource reference`,
        severity: "informational",
        confidence: "low",
        description: "One or more deep-link data attributes (scheme/host/path) reference an unresolved manifest placeholder (e.g. ${applicationId}) or Android resource (e.g. @string/...). Effective exposure cannot be assessed statically.",
        manifestPath: entry.manifestPath,
        identity,
        location: filter.location,
        evidenceDetails,
      })
    );
    return;
  }

  if (broadPattern) {
    const strongEvidence = exportedExplicitTrue && unprotected;
    findings.push(
      makeAndroidFinding({
        ruleId: "android-deep-link-broad-path-pattern",
        title: `Broad/wildcard deep-link path pattern on ${kind} "${identity}"`,
        severity: strongEvidence ? "major" : "minor",
        confidence: strongEvidence ? "high" : "medium",
        description: strongEvidence
          ? "This deep-link filter uses a highly permissive pathPattern, the component is explicitly exported, and no component-level permission protects it — a strong static combination of broad matching and open reachability."
          : "This deep-link filter uses a broad/wildcard-like pathPattern. Broad path matching is not automatically exploitable, but widens the set of URLs the app will handle.",
        manifestPath: entry.manifestPath,
        identity,
        location: filter.location,
        evidenceDetails,
        recommendation: "Narrow the pathPattern to only the routes the app actually needs to handle, and validate any path/query data before use.",
      })
    );
    return;
  }

  if (scheme === "web" && !hasHost) {
    findings.push(
      makeAndroidFinding({
        ruleId: "android-deep-link-web-link-without-host",
        title: `HTTP/HTTPS deep link on ${kind} "${identity}" has no host restriction`,
        severity: "minor",
        confidence: "medium",
        description: "This web-link intent filter declares an http/https scheme without a host, so it is not restricted to a specific domain.",
        manifestPath: entry.manifestPath,
        identity,
        location: filter.location,
        evidenceDetails,
        recommendation: "Add android:host to restrict which domains this filter matches.",
      })
    );
    return;
  }

  if (scheme === "custom" && !hasHost) {
    findings.push(
      makeAndroidFinding({
        ruleId: "android-deep-link-custom-scheme-without-host",
        title: `Custom-scheme deep link on ${kind} "${identity}" has no host restriction`,
        severity: "minor",
        confidence: "medium",
        description: "This custom-scheme intent filter declares no host restriction. Custom schemes are not automatically vulnerabilities, but an unrestricted scheme accepts any host/path combination.",
        manifestPath: entry.manifestPath,
        identity,
        location: filter.location,
        evidenceDetails,
        recommendation: "Consider restricting the host or validating incoming URIs defensively in the handling code.",
      })
    );
    return;
  }

  // Bounded/safe deep link: explicit scheme + host (+ optional path
  // restriction), no wildcard pattern, no placeholders — recorded for
  // inventory purposes at informational severity only (ANDROID-B3-24).
  findings.push(
    makeAndroidFinding({
      ruleId: "android-deep-link-bounded",
      title: `Deep link declared on ${kind} "${identity}"`,
      severity: "informational",
      confidence: "high",
      description: "This deep-link filter declares an explicit scheme and host with bounded path evidence. No static exposure concern was identified.",
      manifestPath: entry.manifestPath,
      identity,
      location: filter.location,
      evidenceDetails,
    })
  );
}

function componentGroups(entry: AndroidManifestParseEntry): { kind: AndroidManifestComponentKind; components: AndroidManifestComponent[] }[] {
  return [
    { kind: "activity" as const, components: entry.manifest.activities },
    { kind: "activity-alias" as const, components: entry.manifest.activityAliases ?? [] },
  ];
}

export function auditAndroidDeepLinks(detection: AndroidDetectionResult, manifests: AndroidManifestParseEntry[]): AndroidCheckResult {
  const findings: SecurityFinding[] = [];
  const evidence: string[] = [];
  const warnings: string[] = [];

  for (const entry of manifests) {
    let candidateCount = 0;
    for (const group of componentGroups(entry)) {
      for (const component of group.components) {
        for (const filter of component.intentFilters) {
          const actions = filter.actions ?? [];
          const categories = filter.categories ?? [];
          if (actions.includes(VIEW_ACTION) || categories.includes(BROWSABLE_CATEGORY)) {
            candidateCount += 1;
            auditDeepLinkFilter(entry, group.kind, component, filter, findings);
          }
        }
      }
    }
    if (candidateCount > 0) {
      evidence.push(`${entry.manifestPath}: ${candidateCount} deep-link candidate intent-filter(s) inspected`);
    }
  }

  return buildAndroidManifestCheckResult({
    id: "android-deep-links-audit",
    category: "android-deep-links",
    title: "Android deep-link audit",
    detection,
    manifests,
    findings,
    evidence,
    warnings,
  });
}
