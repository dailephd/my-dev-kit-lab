import path from "node:path";
import type { SecurityFinding } from "../../../../securityValidation/types.js";
import type { AndroidManifestParseEntry } from "../../manifest/parseAndroidManifest.js";
import { makeAndroidFinding } from "../../audit/androidFinding.js";
import { buildAndroidSourceLocation, type AndroidSourceLocation } from "../sourceLocation.js";
import { makeCandidateEvidence, type CandidateEvidence } from "../candidateEvidence.js";
import { extractManifestNetworkSecurityEvidence, type ManifestNetworkSecurityEvidence } from "./manifestEvidence.js";
import { deriveEffectiveNetworkPolicy, type EffectiveNetworkScope } from "./deriveEffectiveNetworkPolicy.js";
import type { NetworkSecurityConfigParseResult, NscPinSet, NscTrustAnchors } from "./types.js";

// ---------------------------------------------------------------------------
// v0.4.1 Batch 2 — conservative cleartext/trust-anchor/domain/pin analysis.
//
// Produces Batch 1's CandidateEvidence for review-oriented, non-confirmed
// evidence and the existing SecurityFinding model (via makeAndroidFinding)
// for high-confidence conservative findings, per agents.txt Batch 2 sections
// 9.6-9.12. Static-analysis claim boundaries (section 16) are enforced by
// construction: only an explicit `true`/user-added-CA value ever becomes a
// finding; everything else (missing/malformed/ambiguous/unresolved/pin
// absence/system CA/debug overrides) is candidate evidence or plain evidence
// text, never a finding.
// ---------------------------------------------------------------------------

export type AnalyzeNetworkSecurityResult = {
  evidence: ManifestNetworkSecurityEvidence;
  candidates: CandidateEvidence[];
  findings: SecurityFinding[];
};

function loc(targetRoot: string, absolutePath: string, position?: { line?: number; column?: number }): AndroidSourceLocation {
  return buildAndroidSourceLocation(targetRoot, absolutePath, position);
}

function analyzeScopeCleartext(scope: EffectiveNetworkScope, sourceRelativePath: string): SecurityFinding | undefined {
  if (scope.cleartextTrafficPermitted !== true) return undefined;

  const isBase = scope.kind === "base";
  const domainsText = scope.domains.map((d) => d.normalized).filter((d) => d.length > 0).join(", ");

  return makeAndroidFinding({
    ruleId: "android-network-cleartext-traffic",
    title: isBase
      ? "Network Security Config base configuration permits cleartext traffic"
      : `Network Security Config domain configuration permits cleartext traffic${domainsText ? ` (${domainsText})` : ""}`,
    severity: isBase ? "major" : "minor",
    confidence: "high",
    description: isBase
      ? "The Network Security Config's <base-config> sets cleartextTrafficPermitted=\"true\", which is high-confidence static evidence that cleartext (unencrypted) HTTP traffic is permitted application-wide unless narrowed by a more specific domain-config. This does not prove cleartext traffic actually occurs at runtime."
      : `A <domain-config> sets cleartextTrafficPermitted="true" for the scoped domain(s) above. This is high-confidence static evidence limited to that domain scope${scope.domains.some((d) => d.includeSubdomains) ? " (including subdomains for at least one entry)" : ""}, not proof that cleartext traffic actually occurs at runtime.`,
    manifestPath: sourceRelativePath,
    identity: scope.scopeId,
    location: { line: scope.location.line, column: scope.location.column },
    evidenceDetails: [
      `scope=${scope.kind}`,
      `cleartextTrafficSource=${scope.cleartextTrafficSource}`,
      ...(isBase ? [] : [`domains=${domainsText || "(none declared; scope has no resolvable domain list)"}`]),
    ],
    recommendation: "Disable cleartext traffic unless a specific, documented use case requires it, and scope any exception as narrowly as possible.",
  });
}

function analyzeScopeTrustAnchors(
  scope: EffectiveNetworkScope,
  sourceAbsolutePath: string,
  targetRoot: string,
  modulePath: string | undefined,
  sourceRelativePath: string
): { candidates: CandidateEvidence[]; findings: SecurityFinding[] } {
  const candidates: CandidateEvidence[] = [];
  const findings: SecurityFinding[] = [];
  if (scope.trustAnchorsChain.length === 0) return { candidates, findings };

  // The nearest entry in the chain is the one that actually governs this
  // scope (own, or the closest ancestor it inherited from) — not every
  // entry in the chain, which would double-count inherited certificates
  // once per descendant scope.
  const nearest = scope.trustAnchorsChain[0];
  for (const cert of nearest.certificates) {
    const location = loc(targetRoot, sourceAbsolutePath, { line: cert.location.line, column: cert.location.column });
    if (cert.sourceKind === "user") {
      findings.push(
        makeAndroidFinding({
          ruleId: "android-network-user-added-trust-anchor",
          title: `${scope.kind === "base" ? "Base" : "Domain-scoped"} configuration trusts user-added certificate authorities`,
          severity: scope.kind === "base" ? "major" : "minor",
          confidence: "high",
          description:
            "The configuration includes <certificates src=\"user\">, meaning certificates a device user has added to the trust store are trusted for TLS connections in this scope. This is high-confidence static evidence of the trust configuration itself, not proof of an active interception (e.g. MITM) attack.",
          manifestPath: sourceRelativePath,
          identity: scope.scopeId,
          location: { line: cert.location.line, column: cert.location.column },
          evidenceDetails: [`scope=${scope.kind}`, `certificatesSrc=user`, cert.overridePinsRaw !== undefined ? `overridePins=${cert.overridePinsRaw}` : undefined].filter(
            (v): v is string => Boolean(v)
          ),
          recommendation: "Avoid trusting user-added CAs in release configuration unless a specific, reviewed use case (e.g. enterprise proxy/MDM) requires it.",
        })
      );
    } else if (cert.sourceKind === "raw-resource") {
      candidates.push(
        makeCandidateEvidence({
          ruleId: "android-network-user-added-trust-anchor",
          category: "android-network-security",
          confidence: "medium",
          modulePath,
          location,
          summary: `Custom raw certificate authority referenced (@raw/${cert.rawResourceName ?? "?"}) in ${scope.kind} configuration`,
          rawValue: cert.rawResourceName,
          resolutionState: "resolved",
          staticAnalysisLimitations: ["Certificate contents were not inspected or validated; a custom CA is not automatically unsafe."],
        })
      );
    } else if (cert.sourceKind === "unknown") {
      candidates.push(
        makeCandidateEvidence({
          ruleId: "android-network-user-added-trust-anchor",
          category: "android-network-security",
          confidence: "low",
          modulePath,
          location,
          summary: `Unrecognized <certificates src="..."> value in ${scope.kind} configuration`,
          rawValue: cert.srcRaw,
          resolutionState: "unsupported",
        })
      );
    }
    // "system" is normal evidence, not a finding or candidate by itself.
  }
  return { candidates, findings };
}

function analyzeDebugOverrides(
  debugTrustAnchors: NscTrustAnchors | undefined,
  sourceAbsolutePath: string,
  targetRoot: string,
  modulePath: string | undefined
): CandidateEvidence[] {
  if (!debugTrustAnchors) return [];
  return debugTrustAnchors.certificates.map((cert) =>
    makeCandidateEvidence({
      ruleId: "android-network-debug-trust-override",
      category: "android-network-security",
      confidence: "low",
      modulePath,
      location: loc(targetRoot, sourceAbsolutePath, { line: cert.location.line, column: cert.location.column }),
      summary: `Debug-only trust override: <certificates src="${cert.srcRaw ?? "unknown"}">`,
      rawValue: cert.srcRaw,
      resolutionState: "resolved",
      staticAnalysisLimitations: [
        "<debug-overrides> only applies to builds with android:debuggable=\"true\" and must never be treated as active release-build policy.",
      ],
    })
  );
}

const BROAD_DOMAIN_MAX_SINGLE_LABEL_LENGTH = 3;

function analyzeDomainBroadness(scope: EffectiveNetworkScope, sourceAbsolutePath: string, targetRoot: string, modulePath: string | undefined): CandidateEvidence[] {
  const candidates: CandidateEvidence[] = [];
  for (const domain of scope.domains) {
    const location = loc(targetRoot, sourceAbsolutePath, { line: domain.location.line, column: domain.location.column });
    if (domain.malformed) {
      candidates.push(
        makeCandidateEvidence({
          ruleId: "android-network-broad-domain-config",
          category: "android-network-security",
          confidence: "low",
          modulePath,
          location,
          summary: "Empty or malformed <domain> entry",
          rawValue: domain.textRaw,
          resolutionState: "malformed",
        })
      );
      continue;
    }

    const isWildcardLike = domain.normalized.includes("*");
    // A conservative "narrow" broadness signal only: a bare, very short
    // single-label host (no dot at all) is unusual for a real public/
    // internal domain and worth a low-confidence review candidate. Ordinary
    // multi-label domains (including internal-looking ones) never match —
    // per section 9.8, ambiguous/potentially-legitimate internal domains
    // must remain unflagged rather than produce false positives.
    const isSuspiciouslyShortSingleLabel = !domain.normalized.includes(".") && domain.normalized.length <= BROAD_DOMAIN_MAX_SINGLE_LABEL_LENGTH;

    if (isWildcardLike || isSuspiciouslyShortSingleLabel) {
      candidates.push(
        makeCandidateEvidence({
          ruleId: "android-network-broad-domain-config",
          category: "android-network-security",
          confidence: "low",
          modulePath,
          location,
          summary: `Potentially broad domain candidate: "${domain.normalized}"${domain.includeSubdomains ? " (includeSubdomains)" : ""}`,
          rawValue: domain.textRaw,
          resolutionState: "resolved",
          staticAnalysisLimitations: [
            "Domain registrability/ownership was not verified (no network or public-suffix-list access); this may be a legitimate internal or short hostname.",
          ],
        })
      );
    }
  }
  return candidates;
}

function analyzePinSet(pinSet: NscPinSet | undefined, sourceAbsolutePath: string, targetRoot: string, modulePath: string | undefined): CandidateEvidence[] {
  if (!pinSet) return [];
  const candidates: CandidateEvidence[] = [];

  candidates.push(
    makeCandidateEvidence({
      ruleId: "android-network-pinning-metadata",
      category: "android-network-security",
      confidence: "high",
      modulePath,
      location: loc(targetRoot, sourceAbsolutePath, { line: pinSet.location.line, column: pinSet.location.column }),
      summary: `Certificate pin-set present (${pinSet.pins.length} pin(s)${pinSet.expirationRaw ? `, expiration=${pinSet.expirationRaw}` : ", no expiration set"})`,
      rawValue: pinSet.expirationRaw,
      resolutionState: pinSet.expirationMalformed ? "malformed" : "resolved",
      staticAnalysisLimitations: [
        "Pin values were not validated against any live certificate or TLS connection; presence of pin metadata does not prove pinning is effective at runtime, and its absence is not automatically a vulnerability.",
        ...(pinSet.expirationMalformed ? ["expiration attribute is not in the expected YYYY-MM-DD format."] : []),
      ],
    })
  );

  for (const pin of pinSet.pins) {
    if (pin.malformed || !pin.digestSupported) {
      candidates.push(
        makeCandidateEvidence({
          ruleId: "android-network-pinning-unresolved",
          category: "android-network-security",
          confidence: "medium",
          modulePath,
          location: loc(targetRoot, sourceAbsolutePath, { line: pin.location.line, column: pin.location.column }),
          summary: pin.malformed ? `Malformed pin entry: ${pin.malformedReason}` : `Unsupported pin digest algorithm: "${pin.digestRaw}"`,
          rawValue: pin.valuePreview,
          resolutionState: pin.malformed ? "malformed" : "unsupported",
        })
      );
    }
  }
  return candidates;
}

function analyzeParsedFile(
  parseResult: Extract<NetworkSecurityConfigParseResult, { state: "parsed" }>,
  fileRelativePath: string,
  targetRoot: string,
  modulePath: string | undefined
): { candidates: CandidateEvidence[]; findings: SecurityFinding[]; baseCleartextExplicitFalse: boolean } {
  const fileAbsolutePath = path.join(targetRoot, fileRelativePath);
  const policy = deriveEffectiveNetworkPolicy(parseResult);
  const candidates: CandidateEvidence[] = [];
  const findings: SecurityFinding[] = [];

  const scopes: EffectiveNetworkScope[] = [...(policy.baseScope ? [policy.baseScope] : []), ...policy.domainScopes];
  for (const scope of scopes) {
    const cleartextFinding = analyzeScopeCleartext(scope, fileRelativePath);
    if (cleartextFinding) findings.push(cleartextFinding);

    const trustResult = analyzeScopeTrustAnchors(scope, fileAbsolutePath, targetRoot, modulePath, fileRelativePath);
    candidates.push(...trustResult.candidates);
    findings.push(...trustResult.findings);

    candidates.push(...analyzeDomainBroadness(scope, fileAbsolutePath, targetRoot, modulePath));
    candidates.push(...analyzePinSet(scope.pinSet, fileAbsolutePath, targetRoot, modulePath));
  }

  candidates.push(...analyzeDebugOverrides(policy.debugTrustAnchors, fileAbsolutePath, targetRoot, modulePath));

  return { candidates, findings, baseCleartextExplicitFalse: policy.baseScope?.cleartextTrafficPermitted === false };
}

function analyzeResolvedOrAmbiguousFile(
  fileRelativePath: string,
  parseResult: NetworkSecurityConfigParseResult,
  targetRoot: string,
  modulePath: string | undefined
): { candidates: CandidateEvidence[]; findings: SecurityFinding[]; baseCleartextExplicitFalse: boolean } {
  const fileAbsolutePath = path.join(targetRoot, fileRelativePath);

  if (parseResult.state === "malformed-xml") {
    return {
      candidates: [
        makeCandidateEvidence({
          ruleId: "android-network-security-config",
          category: "android-network-security",
          confidence: "medium",
          modulePath,
          location: loc(targetRoot, fileAbsolutePath, parseResult.location ? { line: parseResult.location.line, column: parseResult.location.column } : undefined),
          summary: `Referenced Network Security Config is malformed XML: ${parseResult.reason}`,
          rawValue: parseResult.reason,
          resolutionState: "malformed",
        }),
      ],
      findings: [],
      baseCleartextExplicitFalse: false,
    };
  }

  if (parseResult.state === "unsupported-root") {
    return {
      candidates: [
        makeCandidateEvidence({
          ruleId: "android-network-security-config",
          category: "android-network-security",
          confidence: "medium",
          modulePath,
          location: loc(targetRoot, fileAbsolutePath),
          summary: `Referenced XML file has an unsupported root element <${parseResult.rootTagName}>, not <network-security-config>`,
          rawValue: parseResult.rootTagName,
          resolutionState: "unsupported",
        }),
      ],
      findings: [],
      baseCleartextExplicitFalse: false,
    };
  }

  return analyzeParsedFile(parseResult, fileRelativePath, targetRoot, modulePath);
}

// Analyzes one already-parsed manifest's cleartext/Network Security Config
// evidence, without touching validateAndroidTarget or any active
// orchestration (this function is standalone until a later integration
// batch).
export function analyzeManifestNetworkSecurity(targetRoot: string, entry: AndroidManifestParseEntry): AnalyzeNetworkSecurityResult {
  const evidence = extractManifestNetworkSecurityEvidence(targetRoot, entry);
  const candidates: CandidateEvidence[] = [];
  const findings: SecurityFinding[] = [];
  const modulePath = entry.modulePath;
  const manifestAbsolutePath = path.join(targetRoot, entry.manifestPath);
  const nsc = evidence.networkSecurityConfig;

  let anyResolvedNsc = false;
  let anyResolvedBaseExplicitFalse = false;

  if (nsc.state === "resolved") {
    anyResolvedNsc = true;
    const result = analyzeResolvedOrAmbiguousFile(nsc.candidate.relativePath, nsc.parseResult, targetRoot, modulePath);
    candidates.push(...result.candidates);
    findings.push(...result.findings);
    anyResolvedBaseExplicitFalse = result.baseCleartextExplicitFalse;
  } else if (nsc.state === "ambiguous") {
    anyResolvedNsc = true;
    candidates.push(
      makeCandidateEvidence({
        ruleId: "android-network-security-config",
        category: "android-network-security",
        confidence: "low",
        modulePath,
        location: loc(targetRoot, manifestAbsolutePath, evidence.applicationLocation),
        summary: `networkSecurityConfig reference "${nsc.raw}" resolved to ${nsc.candidates.length} ambiguous candidates across source sets; no candidate was arbitrarily selected`,
        rawValue: nsc.raw,
        resolutionState: "unresolved",
        staticAnalysisLimitations: ["Android resource-overlay precedence between the candidates was not evaluated."],
      })
    );
    let anyBaseFalse = false;
    for (const candidate of nsc.candidates) {
      const result = analyzeResolvedOrAmbiguousFile(candidate.candidate.relativePath, candidate.parseResult, targetRoot, modulePath);
      candidates.push(...result.candidates);
      findings.push(...result.findings);
      anyBaseFalse = anyBaseFalse || result.baseCleartextExplicitFalse;
    }
    anyResolvedBaseExplicitFalse = anyBaseFalse;
  } else if (nsc.state === "missing") {
    candidates.push(
      makeCandidateEvidence({
        ruleId: "android-network-security-config",
        category: "android-network-security",
        confidence: "low",
        modulePath,
        location: loc(targetRoot, manifestAbsolutePath, evidence.applicationLocation),
        summary: `networkSecurityConfig reference "${nsc.raw}" did not resolve to any file in the searched source sets`,
        rawValue: nsc.raw,
        resolutionState: "missing",
        staticAnalysisLimitations: ["A missing referenced configuration is not automatically a vulnerability; runtime behavior in this case cannot be proven statically."],
      })
    );
  } else if (nsc.state === "placeholder") {
    candidates.push(
      makeCandidateEvidence({
        ruleId: "android-network-security-config",
        category: "android-network-security",
        confidence: "low",
        modulePath,
        location: loc(targetRoot, manifestAbsolutePath, evidence.applicationLocation),
        summary: "networkSecurityConfig is an unresolved build-time placeholder",
        rawValue: nsc.raw,
        resolutionState: "unresolved",
      })
    );
  } else if (nsc.state === "malformed") {
    candidates.push(
      makeCandidateEvidence({
        ruleId: "android-network-security-config",
        category: "android-network-security",
        confidence: "low",
        modulePath,
        location: loc(targetRoot, manifestAbsolutePath, evidence.applicationLocation),
        summary: `networkSecurityConfig reference is malformed: ${nsc.reason}`,
        rawValue: nsc.raw,
        resolutionState: "malformed",
      })
    );
  } else if (nsc.state === "unsupported-type" || nsc.state === "package-qualified" || nsc.state === "module-unknown") {
    candidates.push(
      makeCandidateEvidence({
        ruleId: "android-network-security-config",
        category: "android-network-security",
        confidence: "low",
        modulePath,
        location: loc(targetRoot, manifestAbsolutePath, evidence.applicationLocation),
        summary:
          nsc.state === "module-unknown"
            ? "networkSecurityConfig reference could not be resolved because this manifest's module could not be determined"
            : `networkSecurityConfig reference is not a resolvable target-contained @xml/... resource (${nsc.state})`,
        rawValue: nsc.raw,
        resolutionState: "unsupported",
      })
    );
  }

  if (evidence.usesCleartextTraffic.state === "malformed") {
    candidates.push(
      makeCandidateEvidence({
        ruleId: "android-network-cleartext-traffic",
        category: "android-network-security",
        confidence: "low",
        modulePath,
        location: loc(targetRoot, manifestAbsolutePath, evidence.applicationLocation),
        summary: "android:usesCleartextTraffic has an unresolved or malformed value",
        rawValue: evidence.usesCleartextTraffic.raw,
        resolutionState: "malformed",
      })
    );
  } else if (evidence.usesCleartextTraffic.state === "explicit-true") {
    if (!anyResolvedNsc) {
      findings.push(
        makeAndroidFinding({
          ruleId: "android-network-cleartext-traffic",
          title: "Manifest explicitly permits cleartext traffic (android:usesCleartextTraffic=\"true\")",
          severity: "major",
          confidence: "high",
          description:
            "The manifest's <application> element sets android:usesCleartextTraffic=\"true\" with no resolvable Network Security Config to narrow it. This is high-confidence static evidence that cleartext (unencrypted) HTTP traffic is permitted application-wide; it is not proof that cleartext traffic actually occurs at runtime.",
          manifestPath: entry.manifestPath,
          location: evidence.applicationLocation,
          evidenceDetails: ["source=manifest-attribute", "networkSecurityConfig=absent-or-unresolved"],
          recommendation: "Set android:usesCleartextTraffic=\"false\" unless a specific, documented use case requires cleartext traffic.",
        })
      );
    } else if (anyResolvedBaseExplicitFalse) {
      candidates.push(
        makeCandidateEvidence({
          ruleId: "android-network-cleartext-traffic",
          category: "android-network-security",
          confidence: "medium",
          modulePath,
          location: loc(targetRoot, manifestAbsolutePath, evidence.applicationLocation),
          summary:
            "android:usesCleartextTraffic=\"true\" conflicts with the resolved Network Security Config's <base-config cleartextTrafficPermitted=\"false\">",
          rawValue: evidence.usesCleartextTraffic.raw,
          resolutionState: "resolved",
          staticAnalysisLimitations: [
            "Precedence between the manifest attribute and the Network Security Config was not evaluated for a specific Android API level; this is conflicting static configuration, not a confirmed runtime state.",
          ],
        })
      );
    } else {
      findings.push(
        makeAndroidFinding({
          ruleId: "android-network-cleartext-traffic",
          title: "Manifest explicitly permits cleartext traffic (android:usesCleartextTraffic=\"true\")",
          severity: "major",
          confidence: "high",
          description:
            "The manifest's <application> element sets android:usesCleartextTraffic=\"true\". A Network Security Config is present but does not explicitly set cleartextTrafficPermitted=\"false\" at the base level, so this attribute's effect is not contradicted by static evidence.",
          manifestPath: entry.manifestPath,
          location: evidence.applicationLocation,
          evidenceDetails: ["source=manifest-attribute", "networkSecurityConfig=resolved-non-contradicting"],
          recommendation: "Set android:usesCleartextTraffic=\"false\" unless a specific, documented use case requires cleartext traffic.",
        })
      );
    }
  }

  return { evidence, candidates, findings };
}
