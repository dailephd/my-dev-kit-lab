// ---------------------------------------------------------------------------
// v0.4.0 Batch 3 — bounded, deterministic, dependency-free XML parser for
// AndroidManifest.xml.
//
// No XML parsing dependency exists in this repository (see package.json —
// zero runtime dependencies), so this hand-written recursive-descent scanner
// avoids adding one, per agents.txt Batch 3 section 7.2 ("prefer a small
// bounded parser implementation ... Do not use brittle global regular
// expressions as the primary XML parser"). This is a manual character
// scanner (no regex-based tokenization), tracks line/column for every
// element and attribute, and resolves XML namespace URIs from `xmlns`/
// `xmlns:*` declarations rather than assuming any particular prefix — so an
// `android:` attribute is recognized even if a manifest (unusually)
// re-prefixes the Android namespace.
//
// Deliberately NOT implemented (out of scope for a manifest-only parser):
// DTD/entity resolution beyond skipping DOCTYPE, full XML 1.1 conformance,
// processing-instruction data, and CDATA content extraction (CDATA is
// skipped as opaque text — AndroidManifest.xml has no meaningful use of it).
// ---------------------------------------------------------------------------

export const ANDROID_NAMESPACE_URI = "http://schemas.android.com/apk/res/android";

export type XmlSourceLocation = { line: number; column: number };

export type XmlAttribute = {
  rawName: string;
  prefix?: string;
  localName: string;
  namespaceUri?: string;
  value: string;
  location: XmlSourceLocation;
};

export type XmlElement = {
  tagName: string;
  prefix?: string;
  localName: string;
  namespaceUri?: string;
  attributes: XmlAttribute[];
  children: XmlElement[];
  location: XmlSourceLocation;
  // v0.4.1 Batch 2 — direct text content of this element (concatenation of
  // plain text and CDATA sections that are direct children, entity-decoded;
  // excludes descendant elements' own text). Added additively because
  // Network Security Config XML (<domain>example.com</domain>,
  // <pin digest="SHA-256">base64==</pin>) is meaningful only through element
  // text content, which this parser previously discarded entirely (manifest
  // parsing never needed it). Empty string, never undefined, when an element
  // has no text content — existing manifest-parsing consumers that don't
  // read this field are unaffected.
  textContent: string;
};

export type XmlParseWarning = { message: string; location: XmlSourceLocation };
export type XmlParseError = { message: string; location: XmlSourceLocation };

export type XmlParseResult =
  | { ok: true; root: XmlElement; warnings: XmlParseWarning[] }
  | { ok: false; error: XmlParseError; warnings: XmlParseWarning[] };

class XmlSyntaxError extends Error {
  location: XmlSourceLocation;
  constructor(message: string, location: XmlSourceLocation) {
    super(message);
    this.location = location;
  }
}

const NAME_START_PATTERN = /[A-Za-z_:]/;
const NAME_CHAR_PATTERN = /[A-Za-z0-9_.:-]/;

function isNameStartChar(ch: string | undefined): boolean {
  return ch !== undefined && NAME_START_PATTERN.test(ch);
}
function isNameChar(ch: string | undefined): boolean {
  return ch !== undefined && NAME_CHAR_PATTERN.test(ch);
}
function isWhitespace(ch: string | undefined): boolean {
  return ch === " " || ch === "\t" || ch === "\n" || ch === "\r";
}

class Scanner {
  private text: string;
  private pos = 0;
  private line = 1;
  private column = 1;

  constructor(text: string) {
    // Strip a UTF-8 BOM if present so it doesn't count as document content.
    this.text = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  }

  loc(): XmlSourceLocation {
    return { line: this.line, column: this.column };
  }

  eof(): boolean {
    return this.pos >= this.text.length;
  }

  peek(offset = 0): string | undefined {
    return this.text[this.pos + offset];
  }

  startsWith(literal: string): boolean {
    return this.text.startsWith(literal, this.pos);
  }

  advance(): string {
    const ch = this.text[this.pos];
    if (ch === undefined) {
      throw new XmlSyntaxError("Unexpected end of document", this.loc());
    }
    this.pos += 1;
    if (ch === "\n") {
      this.line += 1;
      this.column = 1;
    } else {
      this.column += 1;
    }
    return ch;
  }

  skipWhitespace(): void {
    while (!this.eof() && isWhitespace(this.peek())) this.advance();
  }

  expect(literal: string): void {
    if (!this.startsWith(literal)) {
      throw new XmlSyntaxError(`Expected "${literal}"`, this.loc());
    }
    for (let i = 0; i < literal.length; i++) this.advance();
  }

  skipUntil(literal: string): void {
    while (!this.eof() && !this.startsWith(literal)) this.advance();
    if (this.eof()) {
      throw new XmlSyntaxError(`Unterminated construct, expected "${literal}"`, this.loc());
    }
    this.expect(literal);
  }

  // Like skipUntil, but returns the consumed text before `literal` instead of
  // discarding it. Used to capture CDATA section content as element text.
  captureUntil(literal: string): string {
    let captured = "";
    while (!this.eof() && !this.startsWith(literal)) captured += this.advance();
    if (this.eof()) {
      throw new XmlSyntaxError(`Unterminated construct, expected "${literal}"`, this.loc());
    }
    this.expect(literal);
    return captured;
  }
}

type NamespaceScope = Map<string, string>; // prefix ("" = default) -> URI

function resolveNamespace(prefix: string | undefined, scope: NamespaceScope): string | undefined {
  return scope.get(prefix ?? "");
}

function splitQualifiedName(qualifiedName: string): { prefix?: string; localName: string } {
  const colonIndex = qualifiedName.indexOf(":");
  if (colonIndex === -1) return { localName: qualifiedName };
  return { prefix: qualifiedName.slice(0, colonIndex), localName: qualifiedName.slice(colonIndex + 1) };
}

function readName(scanner: Scanner): string {
  const start = scanner.loc();
  if (!isNameStartChar(scanner.peek())) {
    throw new XmlSyntaxError("Expected a name", start);
  }
  let name = "";
  while (isNameChar(scanner.peek())) name += scanner.advance();
  return name;
}

function readQuotedValue(scanner: Scanner): string {
  const quote = scanner.peek();
  if (quote !== `"` && quote !== `'`) {
    throw new XmlSyntaxError("Expected a quoted attribute value", scanner.loc());
  }
  scanner.advance();
  let value = "";
  while (!scanner.eof() && scanner.peek() !== quote) {
    value += scanner.advance();
  }
  if (scanner.eof()) {
    throw new XmlSyntaxError("Unterminated attribute value", scanner.loc());
  }
  scanner.advance();
  return decodeXmlEntities(value);
}

function decodeXmlEntities(raw: string): string {
  return raw
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&amp;/g, "&");
}

function skipMisc(scanner: Scanner, warnings: XmlParseWarning[]): void {
  // Skips whitespace, comments, the XML declaration/processing instructions,
  // and DOCTYPE declarations that may appear between/around elements.
  for (;;) {
    scanner.skipWhitespace();
    if (scanner.startsWith("<!--")) {
      scanner.skipUntil("-->");
      continue;
    }
    if (scanner.startsWith("<?")) {
      scanner.skipUntil("?>");
      continue;
    }
    if (scanner.startsWith("<!DOCTYPE") || scanner.startsWith("<!doctype")) {
      warnings.push({ message: "DOCTYPE declaration encountered and skipped (not evaluated)", location: scanner.loc() });
      scanner.skipUntil(">");
      continue;
    }
    if (scanner.startsWith("<![CDATA[")) {
      scanner.skipUntil("]]>");
      continue;
    }
    break;
  }
}

type RawAttribute = { rawName: string; value: string; location: XmlSourceLocation };

function parseAttributes(scanner: Scanner): { rawAttributes: RawAttribute[]; localScope: NamespaceScope } {
  const rawAttributes: RawAttribute[] = [];
  for (;;) {
    scanner.skipWhitespace();
    const next = scanner.peek();
    if (next === undefined || next === "/" || next === ">") break;
    const location = scanner.loc();
    const rawName = readName(scanner);
    scanner.skipWhitespace();
    scanner.expect("=");
    scanner.skipWhitespace();
    const value = readQuotedValue(scanner);
    rawAttributes.push({ rawName, value, location });
  }

  // Build the namespace scope contributed by this element's own xmlns/xmlns:*
  // attributes so attribute namespace resolution can use it immediately
  // (XML allows an element to both declare and use a namespace prefix).
  const localScope: NamespaceScope = new Map();
  for (const attr of rawAttributes) {
    if (attr.rawName === "xmlns") {
      localScope.set("", attr.value);
    } else if (attr.rawName.startsWith("xmlns:")) {
      localScope.set(attr.rawName.slice("xmlns:".length), attr.value);
    }
  }

  return { rawAttributes, localScope };
}

// Resolves each raw attribute's namespace URI against the combined
// (ancestor + this element's own) namespace scope. `xmlns`/`xmlns:*`
// attributes themselves are preserved as regular attributes (some manifest
// tooling inspects them) but are not namespace-resolved.
function resolveAttributeNamespaces(rawAttributes: RawAttribute[], scope: NamespaceScope, warnings: XmlParseWarning[]): XmlAttribute[] {
  return rawAttributes.map(({ rawName, value, location }) => {
    const { prefix, localName } = splitQualifiedName(rawName);
    if (rawName === "xmlns" || rawName.startsWith("xmlns:")) {
      return { rawName, localName, value, location };
    }
    if (prefix === undefined) {
      return { rawName, localName, value, location };
    }
    const namespaceUri = resolveNamespace(prefix, scope);
    if (namespaceUri === undefined) {
      warnings.push({ message: `Unresolved namespace prefix "${prefix}" on attribute "${rawName}"`, location });
    }
    return { rawName, prefix, localName, namespaceUri, value, location };
  });
}

function parseElement(scanner: Scanner, parentScope: NamespaceScope, warnings: XmlParseWarning[]): XmlElement {
  const location = scanner.loc();
  scanner.expect("<");
  const tagName = readName(scanner);
  const { rawAttributes, localScope } = parseAttributes(scanner);

  const scope: NamespaceScope = localScope.size > 0 ? new Map([...parentScope, ...localScope]) : parentScope;
  const attributes = resolveAttributeNamespaces(rawAttributes, scope, warnings);

  const { prefix, localName } = splitQualifiedName(tagName);
  const namespaceUri = prefix !== undefined ? resolveNamespace(prefix, scope) : resolveNamespace(undefined, scope);

  scanner.skipWhitespace();

  if (scanner.startsWith("/>")) {
    scanner.expect("/>");
    return { tagName, prefix, localName, namespaceUri, attributes, children: [], location, textContent: "" };
  }

  scanner.expect(">");
  const children: XmlElement[] = [];
  const textParts: string[] = [];

  for (;;) {
    skipTextAndMisc(scanner, warnings, textParts);
    if (scanner.startsWith("</")) {
      scanner.expect("</");
      const closingName = readName(scanner);
      scanner.skipWhitespace();
      scanner.expect(">");
      if (closingName !== tagName) {
        throw new XmlSyntaxError(`Mismatched closing tag: expected "</${tagName}>" but found "</${closingName}>"`, location);
      }
      break;
    }
    if (scanner.eof()) {
      throw new XmlSyntaxError(`Unterminated element "<${tagName}>" (missing closing tag)`, location);
    }
    if (scanner.peek() === "<" && isNameStartChar(scanner.peek(1))) {
      children.push(parseElement(scanner, scope, warnings));
      continue;
    }
    // Any other content (unexpected `<` not matching a comment/PI/CDATA/
    // element/closing-tag pattern) is treated as malformed input.
    throw new XmlSyntaxError("Unexpected content while looking for a child element or closing tag", scanner.loc());
  }

  return { tagName, prefix, localName, namespaceUri, attributes, children, location, textContent: decodeXmlEntities(textParts.join("")) };
}

// v0.4.1 Batch 2 — `textParts` accumulates direct text/CDATA content so
// callers needing element text content (e.g. Network Security Config's
// <domain>/<pin> elements) can read it via XmlElement.textContent. Comments,
// processing instructions, and DOCTYPE are still skipped, never counted as
// text — only true character data and CDATA sections are captured.
function skipTextAndMisc(scanner: Scanner, warnings: XmlParseWarning[], textParts: string[]): void {
  for (;;) {
    if (scanner.startsWith("<!--")) {
      scanner.skipUntil("-->");
      continue;
    }
    if (scanner.startsWith("<![CDATA[")) {
      scanner.expect("<![CDATA[");
      textParts.push(scanner.captureUntil("]]>"));
      continue;
    }
    if (scanner.startsWith("<?")) {
      scanner.skipUntil("?>");
      continue;
    }
    if (scanner.peek() === "<") break;
    if (scanner.eof()) break;
    textParts.push(scanner.advance());
  }
}

// Parses `xmlText` into a small element tree. Never throws: all failures are
// reported via the `ok: false` branch with a bounded message and location.
export function parseXmlDocument(xmlText: string): XmlParseResult {
  const warnings: XmlParseWarning[] = [];
  try {
    const scanner = new Scanner(xmlText);
    skipMisc(scanner, warnings);
    if (scanner.eof() || scanner.peek() !== "<") {
      return { ok: false, error: { message: "No root element found", location: scanner.loc() }, warnings };
    }
    const root = parseElement(scanner, new Map(), warnings);
    skipMisc(scanner, warnings);
    if (!scanner.eof()) {
      warnings.push({ message: "Unexpected trailing content after the root element was ignored", location: scanner.loc() });
    }
    return { ok: true, root, warnings };
  } catch (error) {
    if (error instanceof XmlSyntaxError) {
      return { ok: false, error: { message: error.message, location: error.location }, warnings };
    }
    return {
      ok: false,
      error: { message: error instanceof Error ? error.message : "Unknown XML parse error", location: { line: 1, column: 1 } },
      warnings,
    };
  }
}

export function findChildren(element: XmlElement, localName: string, namespaceUri?: string): XmlElement[] {
  return element.children.filter((child) => child.localName === localName && (namespaceUri === undefined || child.namespaceUri === namespaceUri));
}

export function getAttribute(element: XmlElement, localName: string, namespaceUri: string = ANDROID_NAMESPACE_URI): XmlAttribute | undefined {
  return element.attributes.find((attr) => attr.localName === localName && attr.namespaceUri === namespaceUri);
}
