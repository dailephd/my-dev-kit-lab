import type { AgentTokenUsage } from "../agents/types.js";
import type { BenchmarkTaskAnswerKey } from "./types.js";
import type { ParsedAgentAnswer } from "./controlledExperimentTypes.js";

export function parseAgentAnswer(args: { text: string; answerKey?: BenchmarkTaskAnswerKey; tokenUsage?: AgentTokenUsage }): ParsedAgentAnswer {
  const text = args.text.trim();
  const warnings: string[] = [];
  if (!text) {
    return emptyParsedAnswer("failed", ["Agent answer was empty."], args.tokenUsage);
  }

  const jsonParsed = parseJsonAnswer(text, args.tokenUsage);
  if (jsonParsed) {
    return enrichFacts(jsonParsed, text, args.answerKey);
  }

  const fields = collectFieldValues(text);
  const parsed: ParsedAgentAnswer = {
    answerText: fields.get("answer")?.join("\n")?.trim() || text,
    relevantFiles: splitListValues(fields.get("relevantfiles") ?? fields.get("files")),
    relevantSymbols: splitListValues(fields.get("relevantsymbols") ?? fields.get("symbols")),
    expectedFactsFound: splitListValues(fields.get("expectedfactsfound") ?? fields.get("facts") ?? fields.get("factids")),
    confidence: firstValue(fields.get("confidence")),
    commandsRun: splitListValues(fields.get("commandsrun") ?? fields.get("commands")),
    selectedContext: splitListValues(fields.get("selectedcontext") ?? fields.get("context")),
    fullFileReads: splitListValues(fields.get("fullfilereads")),
    fullFileReadJustifications: splitListValues(fields.get("fullfilereadjustifications")),
    parseStatus: "parsed",
    warnings,
    tokenUsage: args.tokenUsage
  };

  if (parsed.relevantFiles.length === 0) {
    parsed.relevantFiles = parseMarkdownSection(text, ["Relevant Files", "Files"]);
  }
  if (parsed.relevantSymbols.length === 0) {
    parsed.relevantSymbols = parseMarkdownSection(text, ["Relevant Symbols", "Symbols"]);
  }
  if (parsed.expectedFactsFound.length === 0) {
    parsed.expectedFactsFound = parseMarkdownSection(text, ["Expected Facts Found", "Facts Found", "Facts"]);
  }
  if (parsed.commandsRun.length === 0) {
    parsed.commandsRun = parseMarkdownSection(text, ["Commands Run", "Commands"]);
  }

  parsed.expectedFactsFound = normalizeFactMatches(parsed.expectedFactsFound, text, args.answerKey);

  if (parsed.answerText.length === 0 || (parsed.relevantFiles.length === 0 && parsed.relevantSymbols.length === 0 && parsed.expectedFactsFound.length === 0)) {
    parsed.parseStatus = parsed.answerText.length > 0 ? "partial" : "failed";
    warnings.push("Agent answer did not include enough structured fields for full parsing.");
  }

  return parsed;
}

function parseJsonAnswer(text: string, tokenUsage?: AgentTokenUsage): ParsedAgentAnswer | undefined {
  const candidates = collectJsonCandidates(text);
  for (const candidate of candidates) {
    try {
      const value = JSON.parse(candidate) as Record<string, unknown>;
      if (!value || typeof value !== "object" || Array.isArray(value)) {
        continue;
      }
      return {
        answerText: readString(value, "answer", "answerText", "finalAnswer") ?? "",
        relevantFiles: readStringArray(value, "relevantFiles", "files"),
        relevantSymbols: readStringArray(value, "relevantSymbols", "symbols"),
        expectedFactsFound: readStringArray(value, "expectedFactsFound", "facts", "factIds"),
        confidence: readString(value, "confidence"),
        commandsRun: readStringArray(value, "commandsRun", "commands"),
        selectedContext: readStringArray(value, "selectedContext", "context"),
        fullFileReads: readStringArray(value, "fullFileReads"),
        fullFileReadJustifications: readStringArray(value, "fullFileReadJustifications"),
        parseStatus: "parsed",
        warnings: [],
        tokenUsage
      };
    } catch {
      // Mixed markdown often contains fenced non-JSON blocks; ignore malformed candidates.
    }
  }
  return undefined;
}

function collectJsonCandidates(text: string): string[] {
  const candidates: string[] = [];
  const trimmed = text.trim();
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    candidates.push(trimmed);
  }
  let cursor = 0;
  while (cursor < text.length) {
    const opening = text.indexOf("```", cursor);
    if (opening < 0) break;
    let bodyStart = opening + 3;
    if (text.slice(bodyStart, bodyStart + 4).toLowerCase() === "json") bodyStart += 4;
    while (bodyStart < text.length && isWhitespace(text[bodyStart]!)) bodyStart += 1;
    const closing = text.indexOf("```", bodyStart);
    if (closing < 0) break;
    const body = text.slice(bodyStart, closing).trim();
    if (body?.startsWith("{")) {
      candidates.push(body);
    }
    cursor = closing + 3;
  }
  return candidates;
}

function collectFieldValues(text: string): Map<string, string[]> {
  const fields = new Map<string, string[]>();
  let currentKey: string | undefined;
  for (const line of text.split(/\r?\n/)) {
    const field = parseStructuredFieldLine(line);
    if (field) {
      currentKey = normalizeKey(field.label);
      const current = fields.get(currentKey) ?? [];
      current.push(stripMarkupOnlyValue(field.value));
      fields.set(currentKey, current);
      continue;
    }
    if (currentKey) {
      const continuation = parseFieldContinuation(line);
      if (continuation !== undefined) fields.get(currentKey)?.push(continuation);
    }
  }
  return fields;
}

function isWhitespace(character: string): boolean {
  return character.trim().length === 0;
}

function parseStructuredFieldLine(line: string): { label: string; value: string } | undefined {
  let start = 0;
  while (start < line.length && isWhitespace(line[start]!)) start += 1;
  if (line[start] === "-" || line[start] === "*") {
    start += 1;
    while (start < line.length && isWhitespace(line[start]!)) start += 1;
  }
  let leadingMarkup = 0;
  while (start < line.length && leadingMarkup < 2 && "*_`".includes(line[start]!)) { start += 1; leadingMarkup += 1; }
  const colon = line.indexOf(":", start);
  if (colon < 0) return undefined;
  let labelEnd = colon;
  let trailingMarkup = 0;
  while (labelEnd > start && trailingMarkup < 2 && "*_`".includes(line[labelEnd - 1]!)) { labelEnd -= 1; trailingMarkup += 1; }
  const label = line.slice(start, labelEnd);
  if (label.length < 2 || label.length > 41 || !isAsciiLetter(label[0]!)) return undefined;
  for (let index = 1; index < label.length; index += 1) {
    const character = label[index]!;
    if (!isAsciiLetter(character) && !(character >= "0" && character <= "9") && character !== " " && character !== "_" && character !== "-") return undefined;
  }
  let valueStart = colon + 1;
  while (valueStart < line.length && isWhitespace(line[valueStart]!)) valueStart += 1;
  return { label, value: line.slice(valueStart) };
}

function isAsciiLetter(character: string): boolean {
  return (character >= "a" && character <= "z") || (character >= "A" && character <= "Z");
}

function parseFieldContinuation(line: string): string | undefined {
  let index = 0;
  while (index < line.length && isWhitespace(line[index]!)) index += 1;
  const indented = index > 0;
  if (index === line.length) return undefined;
  if (line[index] === "-" || line[index] === "*") {
    index += 1;
    const whitespaceStart = index;
    while (index < line.length && isWhitespace(line[index]!)) index += 1;
    if ((!indented && index === whitespaceStart) || index === line.length) return undefined;
    return line.slice(index).trim();
  }
  if (!indented) return undefined;
  return line.slice(index).trim();
}

function parseMarkdownSection(text: string, headings: string[]): string[] {
  const lines = text.split(/\r?\n/);
  const values: string[] = [];
  let inSection = false;
  for (const line of lines) {
    const heading = parseMarkdownHeading(line);
    if (heading !== undefined) {
      inSection = headings.some((candidate) => normalizeKey(candidate) === normalizeKey(heading));
      continue;
    }
    if (!inSection) {
      continue;
    }
    if (isMarkdownHeading(line)) {
      break;
    }
    const bullet = parseMarkdownBullet(line);
    if (bullet !== undefined) {
      values.push(bullet);
    } else if (line.includes(",")) {
      values.push(...splitListValues([line]));
    }
  }
  return unique(values);
}

function parseMarkdownHeading(line: string): string | undefined {
  let index = 0;
  while (index < line.length && isWhitespace(line[index]!)) index += 1;
  const hashStart = index;
  while (index < line.length && line[index] === "#" && index - hashStart < 6) index += 1;
  if (index === hashStart || (index < line.length && line[index] === "#")) return undefined;
  const heading = line.slice(index).trim();
  return heading.length > 0 ? heading : undefined;
}

function isMarkdownHeading(line: string): boolean {
  let index = 0;
  while (index < line.length && isWhitespace(line[index]!)) index += 1;
  const start = index;
  while (index < line.length && line[index] === "#" && index - start < 6) index += 1;
  return index > start && index < line.length && isWhitespace(line[index]!);
}

function parseMarkdownBullet(line: string): string | undefined {
  let index = 0;
  while (index < line.length && isWhitespace(line[index]!)) index += 1;
  if (line[index] !== "-" && line[index] !== "*") return undefined;
  index += 1;
  if (index >= line.length || !isWhitespace(line[index]!)) return undefined;
  while (index < line.length && isWhitespace(line[index]!)) index += 1;
  const content = line.slice(index).trim();
  return content.length > 0 ? content : undefined;
}

function enrichFacts(parsed: ParsedAgentAnswer, text: string, answerKey?: BenchmarkTaskAnswerKey): ParsedAgentAnswer {
  parsed.expectedFactsFound = normalizeFactMatches(parsed.expectedFactsFound, text, answerKey);
  if (parsed.answerText.length === 0) {
    parsed.answerText = text;
  }
  if (parsed.relevantFiles.length === 0 && parsed.relevantSymbols.length === 0 && parsed.expectedFactsFound.length === 0) {
    parsed.parseStatus = "partial";
    parsed.warnings.push("JSON agent answer did not include scoring fields.");
  }
  return parsed;
}

function normalizeFactMatches(values: string[], fullText: string, answerKey?: BenchmarkTaskAnswerKey): string[] {
  if (!answerKey) {
    return unique(values.map(cleanListItem).filter(Boolean));
  }
  const normalizedValues = new Set(values.map(normalizeMatchText));
  const normalizedFullText = normalizeMatchText(fullText);
  const matches: string[] = [];
  for (const fact of answerKey.expectedFacts) {
    const normalizedFactText = normalizeMatchText(fact.text);
    if (
      normalizedValues.has(normalizeMatchText(fact.id)) ||
      normalizedValues.has(normalizedFactText) ||
      normalizedFullText.includes(normalizeMatchText(fact.id)) ||
      (normalizedFactText.length > 20 && normalizedFullText.includes(normalizedFactText))
    ) {
      matches.push(fact.id);
    }
  }
  return unique([...matches, ...values.map(cleanListItem).filter(Boolean)]);
}

function splitListValues(values: string[] | undefined): string[] {
  if (!values) {
    return [];
  }
  return unique(
    values
      .flatMap((value) => value.split(/,|\n/))
      .map(cleanListItem)
      .filter(Boolean)
  );
}

function cleanListItem(value: string): string {
  let source = value;
  let searchFrom = 0;
  while (searchFrom < value.length) {
    const open = value.indexOf("`", searchFrom);
    if (open < 0) break;
    const close = value.indexOf("`", open + 1);
    if (close < 0) break;
    if (close > open + 1) {
      source = value.slice(open + 1, close);
      break;
    }
    searchFrom = close + 1;
  }
  let start = 0;
  let end = source.length;
  while (start < end && isWhitespace(source[start]!)) start += 1;
  while (end > start && isWhitespace(source[end - 1]!)) end -= 1;
  if (source[start] === "-" || source[start] === "*") {
    start += 1;
    while (start < end && isWhitespace(source[start]!)) start += 1;
  }
  while (start < end && (source[start] === '"' || source[start] === "'" || source[start] === "`")) start += 1;
  while (end > start && (source[end - 1] === '"' || source[end - 1] === "'" || source[end - 1] === "`" || source[end - 1] === ".")) end -= 1;
  let whitespaceStart = -1;
  for (let index = start; index < end; index += 1) {
    const character = source[index]!;
    if (isWhitespace(character)) {
      if (whitespaceStart < 0) whitespaceStart = index;
      continue;
    }
    if ((character === "-" || character === "–" || character === "—") && whitespaceStart >= start && index + 1 < end && isWhitespace(source[index + 1]!)) {
      end = whitespaceStart;
      break;
    }
    whitespaceStart = -1;
  }
  return source.slice(start, end).trim();
}

function stripMarkupOnlyValue(value: string): string {
  return /^[*_`\s]+$/.test(value) ? "" : value;
}

function normalizeKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function normalizeMatchText(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function firstValue(values: string[] | undefined): string | undefined {
  return values?.find((value) => value.trim().length > 0)?.trim();
}

function readString(value: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const key of keys) {
    if (typeof value[key] === "string") {
      return value[key] as string;
    }
  }
  return undefined;
}

function readStringArray(value: Record<string, unknown>, ...keys: string[]): string[] {
  for (const key of keys) {
    const field = value[key];
    if (Array.isArray(field)) {
      return field.filter((item): item is string => typeof item === "string");
    }
    if (typeof field === "string") {
      return splitListValues([field]);
    }
  }
  return [];
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function emptyParsedAnswer(
  parseStatus: ParsedAgentAnswer["parseStatus"],
  warnings: string[],
  tokenUsage?: AgentTokenUsage
): ParsedAgentAnswer {
  return {
    answerText: "",
    relevantFiles: [],
    relevantSymbols: [],
    expectedFactsFound: [],
    commandsRun: [],
    selectedContext: [],
    fullFileReads: [],
    fullFileReadJustifications: [],
    parseStatus,
    warnings,
    tokenUsage
  };
}
