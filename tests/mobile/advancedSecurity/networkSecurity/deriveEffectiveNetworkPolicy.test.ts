import { describe, expect, it } from "vitest";
import { parseNetworkSecurityConfig } from "../../../../src/mobile/android/advancedSecurity/networkSecurity/parseNetworkSecurityConfig.js";
import { deriveEffectiveNetworkPolicy } from "../../../../src/mobile/android/advancedSecurity/networkSecurity/deriveEffectiveNetworkPolicy.js";

function parsed(xml: string) {
  const result = parseNetworkSecurityConfig(xml);
  if (result.state !== "parsed") throw new Error("expected parsed");
  return result;
}

// ANDROID-V041-B2-14 — nested domain inheritance at the effective-policy
// layer (parse-tree preservation is covered separately in
// parseNetworkSecurityConfig.test.ts).
describe("deriveEffectiveNetworkPolicy — cleartext inheritance", () => {
  it("a domain-config's explicit cleartextTrafficPermitted wins over the base", () => {
    const policy = deriveEffectiveNetworkPolicy(
      parsed(
        `<network-security-config><base-config cleartextTrafficPermitted="false" /><domain-config cleartextTrafficPermitted="true"><domain>example.com</domain></domain-config></network-security-config>`
      )
    );
    expect(policy.domainScopes[0].cleartextTrafficPermitted).toBe(true);
    expect(policy.domainScopes[0].cleartextTrafficSource).toBe("explicit");
  });

  it("a domain-config without its own value inherits the base's explicit value", () => {
    const policy = deriveEffectiveNetworkPolicy(
      parsed(`<network-security-config><base-config cleartextTrafficPermitted="true" /><domain-config><domain>example.com</domain></domain-config></network-security-config>`)
    );
    expect(policy.domainScopes[0].cleartextTrafficPermitted).toBe(true);
    expect(policy.domainScopes[0].cleartextTrafficSource).toBe("inherited-from-base");
  });

  it("is unspecified when neither the domain-config nor the base declares a value", () => {
    const policy = deriveEffectiveNetworkPolicy(parsed(`<network-security-config><domain-config><domain>example.com</domain></domain-config></network-security-config>`));
    expect(policy.domainScopes[0].cleartextTrafficPermitted).toBeUndefined();
    expect(policy.domainScopes[0].cleartextTrafficSource).toBe("unspecified");
  });

  it("nested domain-config explicit value wins over its parent's inherited-from-base value", () => {
    const policy = deriveEffectiveNetworkPolicy(
      parsed(
        `<network-security-config><base-config cleartextTrafficPermitted="true" /><domain-config><domain>example.com</domain><domain-config cleartextTrafficPermitted="false"><domain>nested.example.com</domain></domain-config></domain-config></network-security-config>`
      )
    );
    const nested = policy.domainScopes.find((s) => s.depth === 1)!;
    expect(nested.cleartextTrafficPermitted).toBe(false);
    expect(nested.cleartextTrafficSource).toBe("explicit");
  });
});

describe("deriveEffectiveNetworkPolicy — trust-anchor inheritance", () => {
  it("a domain-config without its own trust-anchors inherits the base's chain", () => {
    const policy = deriveEffectiveNetworkPolicy(
      parsed(
        `<network-security-config><base-config><trust-anchors><certificates src="user" /></trust-anchors></base-config><domain-config><domain>example.com</domain></domain-config></network-security-config>`
      )
    );
    expect(policy.domainScopes[0].trustAnchorsSource).toBe("inherited");
    expect(policy.domainScopes[0].trustAnchorsChain[0].certificates[0].sourceKind).toBe("user");
  });

  it("a domain-config's own trust-anchors takes precedence over the base's", () => {
    const policy = deriveEffectiveNetworkPolicy(
      parsed(
        `<network-security-config><base-config><trust-anchors><certificates src="system" /></trust-anchors></base-config><domain-config><domain>example.com</domain><trust-anchors><certificates src="user" /></trust-anchors></domain-config></network-security-config>`
      )
    );
    expect(policy.domainScopes[0].trustAnchorsSource).toBe("own");
    expect(policy.domainScopes[0].trustAnchorsChain[0].certificates[0].sourceKind).toBe("user");
  });

  it("is unspecified when no trust-anchors exist anywhere in the chain", () => {
    const policy = deriveEffectiveNetworkPolicy(parsed(`<network-security-config><domain-config><domain>example.com</domain></domain-config></network-security-config>`));
    expect(policy.domainScopes[0].trustAnchorsSource).toBe("unspecified");
    expect(policy.domainScopes[0].trustAnchorsChain).toHaveLength(0);
  });
});

describe("deriveEffectiveNetworkPolicy — pin-set is never inherited", () => {
  it("a domain-config without its own pin-set has no effective pin-set, even if the base has one", () => {
    const policy = deriveEffectiveNetworkPolicy(
      parsed(
        `<network-security-config><base-config><pin-set><pin digest="SHA-256">x</pin></pin-set></base-config><domain-config><domain>example.com</domain></domain-config></network-security-config>`
      )
    );
    expect(policy.domainScopes[0].pinSet).toBeUndefined();
    expect(policy.baseScope?.pinSet?.pins).toHaveLength(1);
  });
});

describe("deriveEffectiveNetworkPolicy — debug-overrides stay separate", () => {
  it("never merges debug-overrides trust anchors into base or domain scopes", () => {
    const policy = deriveEffectiveNetworkPolicy(
      parsed(
        `<network-security-config><base-config cleartextTrafficPermitted="false" /><debug-overrides><trust-anchors><certificates src="user" /></trust-anchors></debug-overrides></network-security-config>`
      )
    );
    expect(policy.baseScope?.trustAnchorsChain).toHaveLength(0);
    expect(policy.debugTrustAnchors?.certificates[0].sourceKind).toBe("user");
  });
});

describe("deriveEffectiveNetworkPolicy — domain inheritance across nested scopes", () => {
  it("a nested domain-config without its own <domain> inherits the parent's domain list", () => {
    const policy = deriveEffectiveNetworkPolicy(
      parsed(
        `<network-security-config><domain-config><domain>example.com</domain><domain-config cleartextTrafficPermitted="true"><trust-anchors><certificates src="user" /></trust-anchors></domain-config></domain-config></network-security-config>`
      )
    );
    const nested = policy.domainScopes.find((s) => s.depth === 1)!;
    expect(nested.domainsInherited).toBe(true);
    expect(nested.domains[0].normalized).toBe("example.com");
  });
});

// ANDROID-V041-B2-27 — deterministic effective policy for equivalent input.
describe("deriveEffectiveNetworkPolicy — determinism", () => {
  it("produces equivalent policy output for repeated derivations", () => {
    const xml = `<network-security-config><base-config cleartextTrafficPermitted="true" /><domain-config><domain>example.com</domain></domain-config></network-security-config>`;
    expect(deriveEffectiveNetworkPolicy(parsed(xml))).toEqual(deriveEffectiveNetworkPolicy(parsed(xml)));
  });
});
