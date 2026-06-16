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
  for (const match of text.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)) {
    const body = match[1]?.trim();
    if (body?.startsWith("{")) {
      candidates.push(body);
    }
  }
  return candidates;
}

function collectFieldValues(text: string): Map<string, string[]> {
  const fields = new Map<string, string[]>();
  let currentKey: string | undefined;
  for (const line of text.split(/\r?\n/)) {
    const fieldMatch = line.match(/^\s*(?:[-*]\s*)?(?:[*_`]{0,2})([A-Za-z][A-Za-z0-9 _-]{1,40})(?:[*_`]{0,2})\s*:\s*(.*)$/);
    if (fieldMatch) {
      currentKey = normalizeKey(fieldMatch[1]);
      const current = fields.get(currentKey) ?? [];
      current.push(stripMarkupOnlyValue(fieldMatch[2] ?? ""));
      fields.set(currentKey, current);
      continue;
    }
    if (currentKey && (/^\s+[-*]?\s*\S/.test(line) || /^\s*[-*]\s+\S/.test(line))) {
      fields.get(currentKey)?.push(line.trim().replace(/^[-*]\s*/, ""));
    }
  }
  return fields;
}

function parseMarkdownSection(text: string, headings: string[]): string[] {
  const lines = text.split(/\r?\n/);
  const values: string[] = [];
  let inSection = false;
  for (const line of lines) {
    const heading = line.match(/^\s*#{1,6}\s*(.+?)\s*$/);
    if (heading) {
      inSection = headings.some((candidate) => normalizeKey(candidate) === normalizeKey(heading[1]));
      continue;
    }
    if (!inSection) {
      continue;
    }
    if (/^\s*#{1,6}\s+/.test(line)) {
      break;
    }
    const bullet = line.match(/^\s*[-*]\s+(.+)$/);
    if (bullet) {
      values.push(bullet[1].trim());
    } else if (line.includes(",")) {
      values.push(...splitListValues([line]));
    }
  }
  return unique(values);
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
  const codeSpan = value.match(/`([^`]+)`/);
  const cleaned = (codeSpan?.[1] ?? value)
    .trim()
    .replace(/^[-*]\s*/, "")
    .replace(/^["'`]+|["'`.]+$/g, "")
    .replace(/\s+[--]\s+.*$/g, "")
    .replace(/\s+[-–—]\s+.*$/g, "")
    .trim();
  return cleaned;
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
