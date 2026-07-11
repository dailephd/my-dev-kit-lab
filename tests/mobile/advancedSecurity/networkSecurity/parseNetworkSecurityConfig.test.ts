import { describe, expect, it } from "vitest";
import { parseNetworkSecurityConfig } from "../../../../src/mobile/android/advancedSecurity/networkSecurity/parseNetworkSecurityConfig.js";
import { MAX_DOMAIN_CONFIG_DEPTH } from "../../../../src/mobile/android/advancedSecurity/networkSecurity/types.js";

// ANDROID-V041-B2-12 — base cleartext policy.
describe("parseNetworkSecurityConfig — base-config", () => {
  it("parses cleartextTrafficPermitted=true with its explicit source", () => {
    const result = parseNetworkSecurityConfig(`<network-security-config><base-config cleartextTrafficPermitted="true" /></network-security-config>`);
    expect(result.state).toBe("parsed");
    if (result.state === "parsed") {
      expect(result.baseConfig?.cleartextTrafficPermitted).toBe(true);
      expect(result.baseConfig?.cleartextTrafficPermittedRaw).toBe("true");
    }
  });

  it("parses cleartextTrafficPermitted=false", () => {
    const result = parseNetworkSecurityConfig(`<network-security-config><base-config cleartextTrafficPermitted="false" /></network-security-config>`);
    if (result.state === "parsed") {
      expect(result.baseConfig?.cleartextTrafficPermitted).toBe(false);
    } else {
      throw new Error("expected parsed");
    }
  });

  it("leaves cleartextTrafficPermitted undefined when the attribute is absent", () => {
    const result = parseNetworkSecurityConfig(`<network-security-config><base-config /></network-security-config>`);
    if (result.state === "parsed") {
      expect(result.baseConfig?.cleartextTrafficPermitted).toBeUndefined();
    } else {
      throw new Error("expected parsed");
    }
  });
});

// ANDROID-V041-B2-13 — domain cleartext policy.
describe("parseNetworkSecurityConfig — domain-config", () => {
  it("preserves domain and includeSubdomains scope for a cleartext-permitting domain-config", () => {
    const result = parseNetworkSecurityConfig(
      `<network-security-config><domain-config cleartextTrafficPermitted="true"><domain includeSubdomains="true">example.com</domain></domain-config></network-security-config>`
    );
    if (result.state !== "parsed") throw new Error("expected parsed");
    const domainConfig = result.domainConfigs[0];
    expect(domainConfig.cleartextTrafficPermitted).toBe(true);
    expect(domainConfig.domains[0].normalized).toBe("example.com");
    expect(domainConfig.domains[0].includeSubdomains).toBe(true);
  });
});

// ANDROID-V041-B2-14 — nested domain inheritance (parse-tree level: nested
// node preserved verbatim, no inheritance applied at parse time).
describe("parseNetworkSecurityConfig — nested domain-config", () => {
  it("preserves a nested domain-config as its own node without merging values", () => {
    const result = parseNetworkSecurityConfig(
      `<network-security-config><domain-config><domain>example.com</domain><domain-config><domain>nested.example.com</domain></domain-config></domain-config></network-security-config>`
    );
    if (result.state !== "parsed") throw new Error("expected parsed");
    const outer = result.domainConfigs[0];
    expect(outer.domains[0].normalized).toBe("example.com");
    expect(outer.nested).toHaveLength(1);
    expect(outer.nested[0].domains[0].normalized).toBe("nested.example.com");
  });
});

// ANDROID-V041-B2-15 — excessive nesting is bounded, not a stack overflow.
describe("parseNetworkSecurityConfig — excessive domain-config nesting", () => {
  function buildDeeplyNested(depth: number): string {
    let xml = `<domain>deep.example.com</domain>`;
    for (let i = 0; i < depth; i++) {
      xml = `<domain-config>${xml}</domain-config>`;
    }
    return `<network-security-config><domain-config>${xml}</domain-config></network-security-config>`;
  }

  it("truncates nesting at the bounded maximum depth without throwing", () => {
    const xml = buildDeeplyNested(MAX_DOMAIN_CONFIG_DEPTH + 20);
    expect(() => parseNetworkSecurityConfig(xml)).not.toThrow();
    const result = parseNetworkSecurityConfig(xml);
    if (result.state !== "parsed") throw new Error("expected parsed");
    let depth = 0;
    let node = result.domainConfigs[0];
    while (node.nested.length > 0) {
      node = node.nested[0];
      depth += 1;
    }
    expect(depth).toBeLessThanOrEqual(MAX_DOMAIN_CONFIG_DEPTH);
  });
});

// ANDROID-V041-B2-16/17/18/19/20 — trust-anchor and debug-override parsing.
describe("parseNetworkSecurityConfig — trust anchors", () => {
  it("classifies certificates src=\"user\"", () => {
    const result = parseNetworkSecurityConfig(
      `<network-security-config><base-config><trust-anchors><certificates src="user" /></trust-anchors></base-config></network-security-config>`
    );
    if (result.state !== "parsed") throw new Error("expected parsed");
    expect(result.baseConfig?.trustAnchors?.certificates[0].sourceKind).toBe("user");
  });

  it("classifies certificates src=\"system\"", () => {
    const result = parseNetworkSecurityConfig(
      `<network-security-config><base-config><trust-anchors><certificates src="system" /></trust-anchors></base-config></network-security-config>`
    );
    if (result.state !== "parsed") throw new Error("expected parsed");
    expect(result.baseConfig?.trustAnchors?.certificates[0].sourceKind).toBe("system");
  });

  it("classifies a custom @raw certificate source and preserves the resource name", () => {
    const result = parseNetworkSecurityConfig(
      `<network-security-config><base-config><trust-anchors><certificates src="@raw/my_ca" /></trust-anchors></base-config></network-security-config>`
    );
    if (result.state !== "parsed") throw new Error("expected parsed");
    const cert = result.baseConfig!.trustAnchors!.certificates[0];
    expect(cert.sourceKind).toBe("raw-resource");
    expect(cert.rawResourceName).toBe("my_ca");
  });

  it("parses debug-overrides trust anchors separately from base/domain config", () => {
    const result = parseNetworkSecurityConfig(
      `<network-security-config><base-config cleartextTrafficPermitted="false" /><debug-overrides><trust-anchors><certificates src="user" /></trust-anchors></debug-overrides></network-security-config>`
    );
    if (result.state !== "parsed") throw new Error("expected parsed");
    expect(result.debugOverrides?.trustAnchors?.certificates[0].sourceKind).toBe("user");
    expect(result.baseConfig?.cleartextTrafficPermitted).toBe(false);
  });

  it("parses overridePins on a certificates entry", () => {
    const result = parseNetworkSecurityConfig(
      `<network-security-config><base-config><trust-anchors><certificates src="user" overridePins="true" /></trust-anchors></base-config></network-security-config>`
    );
    if (result.state !== "parsed") throw new Error("expected parsed");
    expect(result.baseConfig?.trustAnchors?.certificates[0].overridePins).toBe(true);
  });
});

// ANDROID-V041-B2-24/25 — pin-set parsing, including malformed pins.
describe("parseNetworkSecurityConfig — pin-set", () => {
  it("parses digest, bounded value preview, and expiration deterministically", () => {
    const result = parseNetworkSecurityConfig(
      `<network-security-config><domain-config><domain>example.com</domain><pin-set expiration="2030-01-01"><pin digest="SHA-256">FAKEPINVALUE==</pin></pin-set></domain-config></network-security-config>`
    );
    if (result.state !== "parsed") throw new Error("expected parsed");
    const pinSet = result.domainConfigs[0].pinSet!;
    expect(pinSet.expirationRaw).toBe("2030-01-01");
    expect(pinSet.expirationMalformed).toBe(false);
    expect(pinSet.pins[0].digestRaw).toBe("SHA-256");
    expect(pinSet.pins[0].digestSupported).toBe(true);
    expect(pinSet.pins[0].valuePreview).toBe("FAKEPINVALUE==");
    expect(pinSet.pins[0].malformed).toBe(false);
  });

  it("flags a malformed expiration without throwing", () => {
    const result = parseNetworkSecurityConfig(
      `<network-security-config><domain-config><domain>example.com</domain><pin-set expiration="not-a-date"><pin digest="SHA-256">x</pin></pin-set></domain-config></network-security-config>`
    );
    if (result.state !== "parsed") throw new Error("expected parsed");
    expect(result.domainConfigs[0].pinSet?.expirationMalformed).toBe(true);
  });

  it("flags a pin missing a digest attribute as malformed", () => {
    const result = parseNetworkSecurityConfig(
      `<network-security-config><domain-config><domain>example.com</domain><pin-set><pin>novalue</pin></pin-set></domain-config></network-security-config>`
    );
    if (result.state !== "parsed") throw new Error("expected parsed");
    expect(result.domainConfigs[0].pinSet?.pins[0].malformed).toBe(true);
  });

  it("flags an empty pin text content as malformed", () => {
    const result = parseNetworkSecurityConfig(
      `<network-security-config><domain-config><domain>example.com</domain><pin-set><pin digest="SHA-256"></pin></pin-set></domain-config></network-security-config>`
    );
    if (result.state !== "parsed") throw new Error("expected parsed");
    expect(result.domainConfigs[0].pinSet?.pins[0].malformed).toBe(true);
  });

  it("flags an unsupported digest algorithm as not-supported without throwing", () => {
    const result = parseNetworkSecurityConfig(
      `<network-security-config><domain-config><domain>example.com</domain><pin-set><pin digest="SHA-1">x</pin></pin-set></domain-config></network-security-config>`
    );
    if (result.state !== "parsed") throw new Error("expected parsed");
    expect(result.domainConfigs[0].pinSet?.pins[0].digestSupported).toBe(false);
    expect(result.domainConfigs[0].pinSet?.pins[0].malformed).toBe(false);
  });

  it("bounds a very long pin value rather than copying it unbounded", () => {
    const longValue = "A".repeat(5000);
    const result = parseNetworkSecurityConfig(
      `<network-security-config><domain-config><domain>example.com</domain><pin-set><pin digest="SHA-256">${longValue}</pin></pin-set></domain-config></network-security-config>`
    );
    if (result.state !== "parsed") throw new Error("expected parsed");
    expect(result.domainConfigs[0].pinSet?.pins[0].valuePreview.length).toBeLessThan(200);
  });
});

// ANDROID-V041-B2-21/22 — domain normalization.
describe("parseNetworkSecurityConfig — domain normalization", () => {
  it.each([
    ["example.com", "example.com"],
    ["EXAMPLE.COM", "example.com"],
    ["example.com.", "example.com"],
    ["  example.com  ", "example.com"],
  ])("normalizes %s to %s", (raw, expected) => {
    const result = parseNetworkSecurityConfig(`<network-security-config><domain-config><domain>${raw}</domain></domain-config></network-security-config>`);
    if (result.state !== "parsed") throw new Error("expected parsed");
    expect(result.domainConfigs[0].domains[0].normalized).toBe(expected);
  });

  it("marks an empty domain entry as malformed", () => {
    const result = parseNetworkSecurityConfig(`<network-security-config><domain-config><domain></domain></domain-config></network-security-config>`);
    if (result.state !== "parsed") throw new Error("expected parsed");
    expect(result.domainConfigs[0].domains[0].malformed).toBe(true);
  });

  it("normalizes duplicate domain entries identically while preserving both as distinct entries", () => {
    const result = parseNetworkSecurityConfig(
      `<network-security-config><domain-config><domain>Example.com.</domain><domain>example.com</domain></domain-config></network-security-config>`
    );
    if (result.state !== "parsed") throw new Error("expected parsed");
    const domains = result.domainConfigs[0].domains;
    expect(domains).toHaveLength(2);
    expect(domains[0].normalized).toBe(domains[1].normalized);
  });
});

// ANDROID-V041-B2-10 — malformed XML never crashes the parser.
describe("parseNetworkSecurityConfig — malformed XML", () => {
  it("returns a structured malformed-xml result for unterminated markup", () => {
    const result = parseNetworkSecurityConfig(`<network-security-config><base-config cleartextTrafficPermitted="true">`);
    expect(result.state).toBe("malformed-xml");
  });

  it("never throws for malformed input", () => {
    expect(() => parseNetworkSecurityConfig(`<not-even-xml`)).not.toThrow();
    expect(() => parseNetworkSecurityConfig("")).not.toThrow();
  });
});

// ANDROID-V041-B2-11 — unsupported root never masquerades as valid.
describe("parseNetworkSecurityConfig — unsupported root", () => {
  it("reports unsupported-root for a non-network-security-config root element", () => {
    const result = parseNetworkSecurityConfig(`<resources><string name="x">true</string></resources>`);
    expect(result.state).toBe("unsupported-root");
    if (result.state === "unsupported-root") {
      expect(result.rootTagName).toBe("resources");
    }
  });
});

// ANDROID-V041-B2-27 — deterministic output for equivalent input.
describe("parseNetworkSecurityConfig — determinism", () => {
  it("produces equivalent output for repeated parses of the same input", () => {
    const xml = `<network-security-config><base-config cleartextTrafficPermitted="true"><trust-anchors><certificates src="user" /></trust-anchors></base-config></network-security-config>`;
    expect(parseNetworkSecurityConfig(xml)).toEqual(parseNetworkSecurityConfig(xml));
  });
});
