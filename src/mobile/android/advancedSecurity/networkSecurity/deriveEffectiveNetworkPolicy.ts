import type { XmlSourceLocation } from "../../manifest/xml/parseXml.js";
import { MAX_DOMAIN_CONFIG_DEPTH, type NetworkSecurityConfigParseResult, type NscDomainConfig, type NscDomainEntry, type NscPinSet, type NscTrustAnchors } from "./types.js";

// ---------------------------------------------------------------------------
// v0.4.1 Batch 2 — bounded effective-policy derivation over a parsed Network
// Security Config tree.
//
// Read-only: never mutates the parsed tree (agents.txt Batch 2 section 9.5).
// Reproduces the two Android inheritance rules this batch can prove
// statically without Gradle/manifest-merger evaluation:
//   - cleartextTrafficPermitted: a domain-config's own explicit value wins;
//     otherwise it inherits the base-config's explicit value; otherwise
//     unspecified (never guessed as a runtime default).
//   - trust-anchors: a domain-config's own <trust-anchors> wins; otherwise it
//     inherits the nearest ancestor's (nested domain-config) or ultimately
//     the base-config's, preserved as an ordered chain (nearest first) — not
//     flattened away, so the source of each value stays inspectable.
// pin-set is deliberately NOT inherited (real Android behavior: a
// domain-config without its own <pin-set> performs no pin validation for its
// domains — it does not fall back to a parent's pin-set).
// ---------------------------------------------------------------------------

export type EffectiveCleartextSource = "explicit" | "inherited-from-base" | "unspecified";
export type EffectiveTrustAnchorsSource = "own" | "inherited" | "unspecified";

export type EffectiveNetworkScope = {
  scopeId: string;
  kind: "base" | "domain";
  depth: number;
  domains: NscDomainEntry[];
  domainsInherited: boolean;
  cleartextTrafficPermitted?: boolean;
  cleartextTrafficSource: EffectiveCleartextSource;
  trustAnchorsChain: NscTrustAnchors[];
  trustAnchorsSource: EffectiveTrustAnchorsSource;
  pinSet?: NscPinSet;
  location: XmlSourceLocation;
};

export type EffectiveNetworkPolicy = {
  baseScope?: EffectiveNetworkScope;
  domainScopes: EffectiveNetworkScope[];
  // Kept fully separate from baseScope/domainScopes — never merged into
  // release-relevant policy (agents.txt Batch 2 section 9.5's "keep
  // debug-overrides separate from ordinary release-relevant policy").
  debugTrustAnchors?: NscTrustAnchors;
};

function walkDomainConfig(
  node: NscDomainConfig,
  scopeId: string,
  depth: number,
  inheritedDomains: NscDomainEntry[],
  inheritedTrustAnchorsChain: NscTrustAnchors[],
  baseCleartextTrafficPermitted: boolean | undefined,
  out: EffectiveNetworkScope[]
): void {
  if (depth > MAX_DOMAIN_CONFIG_DEPTH) return;

  const domains = node.domains.length > 0 ? node.domains : inheritedDomains;
  const domainsInherited = node.domains.length === 0 && inheritedDomains.length > 0;

  const cleartextTrafficPermitted = node.cleartextTrafficPermitted ?? baseCleartextTrafficPermitted;
  const cleartextTrafficSource: EffectiveCleartextSource =
    node.cleartextTrafficPermitted !== undefined ? "explicit" : baseCleartextTrafficPermitted !== undefined ? "inherited-from-base" : "unspecified";

  const trustAnchorsChain = node.trustAnchors ? [node.trustAnchors, ...inheritedTrustAnchorsChain] : inheritedTrustAnchorsChain;
  const trustAnchorsSource: EffectiveTrustAnchorsSource = node.trustAnchors ? "own" : trustAnchorsChain.length > 0 ? "inherited" : "unspecified";

  out.push({
    scopeId,
    kind: "domain",
    depth,
    domains,
    domainsInherited,
    cleartextTrafficPermitted,
    cleartextTrafficSource,
    trustAnchorsChain,
    trustAnchorsSource,
    pinSet: node.pinSet,
    location: node.location,
  });

  node.nested.forEach((child, index) => {
    walkDomainConfig(child, `${scopeId}>domain-config[${index}]`, depth + 1, domains, trustAnchorsChain, baseCleartextTrafficPermitted, out);
  });
}

// Derives deterministic effective policy from a "parsed" Network Security
// Config result. Callers must narrow to the "parsed" state first — a
// malformed/unsupported-root parse result has no policy to derive.
export function deriveEffectiveNetworkPolicy(parsed: Extract<NetworkSecurityConfigParseResult, { state: "parsed" }>): EffectiveNetworkPolicy {
  const baseScope: EffectiveNetworkScope | undefined = parsed.baseConfig
    ? {
        scopeId: "base-config",
        kind: "base",
        depth: 0,
        domains: [],
        domainsInherited: false,
        cleartextTrafficPermitted: parsed.baseConfig.cleartextTrafficPermitted,
        cleartextTrafficSource: parsed.baseConfig.cleartextTrafficPermitted !== undefined ? "explicit" : "unspecified",
        trustAnchorsChain: parsed.baseConfig.trustAnchors ? [parsed.baseConfig.trustAnchors] : [],
        trustAnchorsSource: parsed.baseConfig.trustAnchors ? "own" : "unspecified",
        pinSet: parsed.baseConfig.pinSet,
        location: parsed.baseConfig.location,
      }
    : undefined;

  const domainScopes: EffectiveNetworkScope[] = [];
  parsed.domainConfigs.forEach((node, index) => {
    walkDomainConfig(node, `domain-config[${index}]`, 0, [], baseScope?.trustAnchorsChain ?? [], baseScope?.cleartextTrafficPermitted, domainScopes);
  });

  return { baseScope, domainScopes, debugTrustAnchors: parsed.debugOverrides?.trustAnchors };
}
