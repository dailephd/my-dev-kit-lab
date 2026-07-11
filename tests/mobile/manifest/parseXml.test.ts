import { describe, expect, it } from "vitest";
import { ANDROID_NAMESPACE_URI, getAttribute, parseXmlDocument } from "../../../src/mobile/android/manifest/xml/parseXml.js";

describe("parseXmlDocument — basic structure", () => {
  it("parses a nested element tree with attributes", () => {
    const result = parseXmlDocument(`<manifest xmlns:android="${ANDROID_NAMESPACE_URI}"><application android:label="App"><activity android:name=".Main"/></application></manifest>`);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.root.localName).toBe("manifest");
    expect(result.root.children[0].localName).toBe("application");
    expect(result.root.children[0].children[0].localName).toBe("activity");
  });

  it("decodes standard XML entities in attribute values", () => {
    const result = parseXmlDocument(`<manifest><application android:label="A &amp; B &lt;C&gt;"/></manifest>`);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.root.children[0].attributes[0].value).toBe("A & B <C>");
  });

  it("handles self-closing and normal tags equivalently", () => {
    const selfClosing = parseXmlDocument(`<manifest><application/></manifest>`);
    const normal = parseXmlDocument(`<manifest><application></application></manifest>`);
    expect(selfClosing.ok && normal.ok).toBe(true);
  });

  it("skips comments and the XML declaration", () => {
    const result = parseXmlDocument(`<?xml version="1.0" encoding="utf-8"?>\n<!-- top comment --><manifest><!-- inner --><application/></manifest>`);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.root.children).toHaveLength(1);
  });
});

// ANDROID-B3-02: Android namespace attributes are parsed correctly even when
// the namespace prefix is not literally "android", provided the URI matches.
describe("parseXmlDocument — namespace resolution — ANDROID-B3-02", () => {
  it("resolves attributes to the Android namespace URI regardless of prefix", () => {
    const result = parseXmlDocument(`<manifest xmlns:x="${ANDROID_NAMESPACE_URI}"><application x:label="App"/></manifest>`);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const attr = getAttribute(result.root.children[0], "label", ANDROID_NAMESPACE_URI);
    expect(attr?.value).toBe("App");
  });

  it("records a warning for an unresolved namespace prefix rather than guessing", () => {
    const result = parseXmlDocument(`<manifest><application android:label="App"/></manifest>`);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.warnings.some((w) => w.message.includes("Unresolved namespace prefix"))).toBe(true);
    const attr = getAttribute(result.root.children[0], "label", ANDROID_NAMESPACE_URI);
    expect(attr).toBeUndefined();
  });
});

describe("parseXmlDocument — malformed input handling", () => {
  it("returns a structured error for mismatched closing tags", () => {
    const result = parseXmlDocument(`<manifest><application></manifest>`);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toContain("Mismatched closing tag");
    expect(result.error.location.line).toBeGreaterThan(0);
  });

  it("returns a structured error for an unterminated element", () => {
    const result = parseXmlDocument(`<manifest><application>`);
    expect(result.ok).toBe(false);
  });

  it("returns a structured error for input with no root element", () => {
    const result = parseXmlDocument(`   `);
    expect(result.ok).toBe(false);
  });

  it("never throws, even for pathological input", () => {
    for (const input of ["<", "<<<<", "</>", "<a><b><c>", "\0\0\0", ""]) {
      expect(() => parseXmlDocument(input)).not.toThrow();
    }
  });
});
