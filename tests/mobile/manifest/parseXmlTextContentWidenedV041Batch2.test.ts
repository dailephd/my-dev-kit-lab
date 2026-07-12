import { describe, expect, it } from "vitest";
import { parseXmlDocument } from "../../../src/mobile/android/manifest/xml/parseXml.js";

// v0.4.1 Batch 2 narrow inherited-contract correction: XmlElement gained
// `textContent` (previously discarded entirely) so Network Security Config's
// <domain>/<pin> elements can be read. Additive only — every existing
// consumer of XmlElement (manifest parsing) never reads this field and is
// unaffected. Regression-tested here per agents.txt Batch 2 section 6.
describe("XmlElement.textContent widening — v0.4.1 Batch 2 inherited-contract regression", () => {
  it("captures direct text content of an element", () => {
    const result = parseXmlDocument(`<domain>example.com</domain>`);
    if (!result.ok) throw new Error("expected ok");
    expect(result.root.textContent).toBe("example.com");
  });

  it("is an empty string, not undefined, for a self-closing element", () => {
    const result = parseXmlDocument(`<certificates src="system" />`);
    if (!result.ok) throw new Error("expected ok");
    expect(result.root.textContent).toBe("");
  });

  it("is an empty string for an element containing only child elements", () => {
    const result = parseXmlDocument(`<pin-set><pin digest="SHA-256">x</pin></pin-set>`);
    if (!result.ok) throw new Error("expected ok");
    expect(result.root.textContent).toBe("");
    expect(result.root.children[0].textContent).toBe("x");
  });

  it("decodes XML entities in text content", () => {
    const result = parseXmlDocument(`<domain>a&amp;b</domain>`);
    if (!result.ok) throw new Error("expected ok");
    expect(result.root.textContent).toBe("a&b");
  });

  it("captures CDATA section content", () => {
    const result = parseXmlDocument(`<domain><![CDATA[example.com]]></domain>`);
    if (!result.ok) throw new Error("expected ok");
    expect(result.root.textContent).toBe("example.com");
  });

  it("does not include a descendant element's own text in the parent's textContent", () => {
    const result = parseXmlDocument(`<domain-config>outer<domain>inner</domain></domain-config>`);
    if (!result.ok) throw new Error("expected ok");
    expect(result.root.textContent).toBe("outer");
    expect(result.root.children[0].textContent).toBe("inner");
  });
});
