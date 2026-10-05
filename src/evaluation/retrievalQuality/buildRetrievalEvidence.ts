import type { MeasuredCommandResult } from "../../core/runMeasuredCommand.js";
import { compareCodeUnits } from "../indexSnapshot.js";
import {
  RETRIEVAL_COMMAND_FAMILIES,
  type BuildRetrievalEvidenceInput,
  type RetrievalCommandEvidenceV1,
  type RetrievalCommandFamily,
  type RetrievalCommandParseState,
  type RetrievalEvidenceCommandInput,
  type RetrievalEvidenceSelection,
  type RetrievalEvidenceV1,
  type RetrievedFileEvidenceV1,
  type RetrievedSymbolEvidenceV1
} from "./types.js";

const MAX_PATH_LENGTH = 1024;

const REASON_COMMAND_FAILED = "command-failed";
const REASON_NOT_JSON = "output-is-not-json";
const REASON_UNSUPPORTED = "output-is-not-the-supported-upstream-schema";
const REASON_REJECTED = "unsafe-or-invalid-identity-rejected";
const REASON_NO_SELECTED_FILE = "no-selected-file-for-source-attribution";
const REASON_SELECTION_UNTRUSTED = "selection-not-backed-by-supported-search-output";
const REASON_DUPLICATE ="repeated-command-family-ignored";

/**
 * Normalizes a repository-relative path to the single platform-neutral form (forward slashes, no leading
 * "./"). Returns null for anything that is not a safe repository-relative path: absolute, drive-qualified,
 * UNC, traversing, or containing empty segments. It never repairs an unsafe value into a plausible one.
 *
 * Same contract as the context-window-scaling plugin's `normalizeRepositoryRelativePath`; kept local so the
 * evaluation layer does not import from an experiment plugin. The unit tests assert the two agree.
 */
export function normalizeRetrievedRepositoryPath(value: unknown): string | null {
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_PATH_LENGTH || value.includes("\0")) {
    return null;
  }
  let normalized = value.replace(/\\/g, "/");
  while (normalized.startsWith("./")) {
    normalized = normalized.slice(2);
  }
  if (normalized.length === 0 || normalized.startsWith("/") || /^[A-Za-z]:/.test(normalized)) {
    return null;
  }
  if (normalized.split("/").some((segment) => segment === ".." || segment === "")) {
    return null;
  }
  return normalized;
}

type Provenance = Set<RetrievalCommandFamily>;
type FileAccumulator = Map<string, Provenance>;
type SymbolAccumulator = Map<string, { name: string; nodeId?: string; file?: string; surfacedBy: Provenance }>;

type CommandInterpretation = {
  parseState: RetrievalCommandParseState;
  files: Set<string>;
  symbolKeys: Set<string>;
  rejected: number;
  reason?: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseJson(text: string): unknown | undefined {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function symbolKey(name: string, nodeId: string | undefined, file: string | undefined): string {
  return nodeId !== undefined ? `id\0${nodeId}` : `name\0${file ?? ""}\0${name}`;
}

type NodeReading =
  | { type: "ignored" }
  | { type: "rejected" }
  | { type: "file"; path: string }
  | { type: "symbol"; name: string; nodeId?: string; file?: string };

/**
 * Reads one upstream node-like entry. Only `file` and `symbol` kinds are evidence; edges and every other
 * kind carry no explicit file/symbol identity of their own and are ignored. Fields are read by their
 * documented names only; identifiers embedded inside other strings are never parsed.
 */
function readNode(entry: unknown, idKey: "id" | "nodeId"): NodeReading {
  if (!isRecord(entry) || typeof entry.kind !== "string") {
    return { type: "rejected" };
  }
  if (entry.kind === "file") {
    const path = normalizeRetrievedRepositoryPath(entry.path);
    return path === null ? { type: "rejected" } : { type: "file", path };
  }
  if (entry.kind === "symbol") {
    const name = typeof entry.symbolName === "string" && entry.symbolName.length > 0 ? entry.symbolName : entry.label;
    if (typeof name !== "string" || name.length === 0) {
      return { type: "rejected" };
    }
    let file: string | undefined;
    if (entry.path !== undefined) {
      const normalized = normalizeRetrievedRepositoryPath(entry.path);
      if (normalized === null) {
        return { type: "rejected" };
      }
      file = normalized;
    }
    const rawId = entry[idKey];
    if (rawId !== undefined && (typeof rawId !== "string" || rawId.length === 0)) {
      return { type: "rejected" };
    }
    return { type: "symbol", name, nodeId: rawId as string | undefined, file };
  }
  return { type: "ignored" };
}

function interpretEntries(
  family: RetrievalCommandFamily,
  entries: readonly unknown[],
  idKey: "id" | "nodeId",
  files: FileAccumulator,
  symbols: SymbolAccumulator
): CommandInterpretation {
  const result: CommandInterpretation = { parseState: "parsed", files: new Set(), symbolKeys: new Set(), rejected: 0 };
  for (const entry of entries) {
    const reading = readNode(entry, idKey);
    if (reading.type === "ignored") continue;
    if (reading.type === "rejected") {
      result.rejected += 1;
      continue;
    }
    if (reading.type === "file") {
      addFile(files, reading.path, family);
      result.files.add(reading.path);
      continue;
    }
    const key = symbolKey(reading.name, reading.nodeId, reading.file);
    const existing = symbols.get(key);
    if (existing) {
      existing.surfacedBy.add(family);
    } else {
      symbols.set(key, { name: reading.name, nodeId: reading.nodeId, file: reading.file, surfacedBy: new Set([family]) });
    }
    result.symbolKeys.add(key);
    if (reading.file !== undefined) {
      // A symbol node carries an explicit file identity, so that file is surfaced by the same command.
      addFile(files, reading.file, family);
      result.files.add(reading.file);
    }
  }
  if (result.rejected > 0) {
    result.reason = REASON_REJECTED;
  }
  return result;
}

function addFile(files: FileAccumulator, path: string, family: RetrievalCommandFamily): void {
  const existing = files.get(path);
  if (existing) {
    existing.add(family);
  } else {
    files.set(path, new Set([family]));
  }
}

function failedInterpretation(parseState: RetrievalCommandParseState, reason: string): CommandInterpretation {
  return { parseState, files: new Set(), symbolKeys: new Set(), rejected: 0, reason };
}

function interpretStructured(
  command: Extract<RetrievalEvidenceCommandInput, { stdout: string }>,
  files: FileAccumulator,
  symbols: SymbolAccumulator
): CommandInterpretation {
  const payload = parseJson(command.stdout);
  if (!isRecord(payload)) {
    return failedInterpretation(payload === undefined ? "malformed" : "unsupported-schema", payload === undefined ? REASON_NOT_JSON : REASON_UNSUPPORTED);
  }
  if (command.family === "search") {
    const supported =
      payload.artifactKind === "my-dev-kit-v1-search-result" &&
      typeof payload.version === "string" &&
      payload.version.startsWith("1.") &&
      Array.isArray(payload.results);
    return supported
      ? interpretEntries("search", payload.results as unknown[], "nodeId", files, symbols)
      : failedInterpretation("unsupported-schema", REASON_UNSUPPORTED);
  }
  if (command.family === "lookup") {
    const supported = payload.status === "found" && isRecord(payload.node) && Array.isArray(payload.neighbors);
    return supported
      ? interpretEntries("lookup", [payload.node, ...(payload.neighbors as unknown[])], "id", files, symbols)
      : failedInterpretation("unsupported-schema", REASON_UNSUPPORTED);
  }
  const supported =
    payload.artifactKind === "my-dev-kit-v1-graph-slice" && typeof payload.version === "string" && payload.version.startsWith("1.") && Array.isArray(payload.nodes);
  return supported
    ? interpretEntries("slice", payload.nodes as unknown[], "id", files, symbols)
    : failedInterpretation("unsupported-schema", REASON_UNSUPPORTED);
}

/**
 * Source output is context text. Evidence is attributed only from the trusted selection the lifecycle
 * passed to the source command: its selected file, and the symbol already surfaced by structured output
 * under the same node id. Nothing is read from the source body.
 */
function attributeSource(
  selection: RetrievalEvidenceSelection | undefined,
  searchInterpreted: boolean,
  files: FileAccumulator,
  symbols: SymbolAccumulator
): CommandInterpretation {
  if (!searchInterpreted) {
    // The selection was derived from search output; without supported search evidence it is not trusted.
    return failedInterpretation("unattributable", REASON_SELECTION_UNTRUSTED);
  }
  if (selection?.file === undefined) {
    return failedInterpretation("unattributable", REASON_NO_SELECTED_FILE);
  }
  const path = normalizeRetrievedRepositoryPath(selection.file);
  if (path === null) {
    return { ...failedInterpretation("unattributable", REASON_REJECTED), rejected: 1 };
  }
  const result: CommandInterpretation = { parseState: "selection-attributed", files: new Set([path]), symbolKeys: new Set(), rejected: 0 };
  addFile(files, path, "source");
  if (selection.nodeId !== undefined) {
    const key = symbolKey("", selection.nodeId, undefined);
    const known = symbols.get(key);
    if (known) {
      known.surfacedBy.add("source");
      result.symbolKeys.add(key);
    }
  }
  return result;
}

function orderedProvenance(provenance: Provenance): RetrievalCommandFamily[] {
  return RETRIEVAL_COMMAND_FAMILIES.filter((family) => provenance.has(family));
}

function isFullyInterpreted(entry: RetrievalCommandEvidenceV1): boolean {
  return (entry.parseState === "parsed" || entry.parseState === "selection-attributed") && entry.rejectedIdentityCount === 0;
}

/**
 * Pure policy: builds normalized retrieval evidence from the commands the lifecycle executed.
 * Deterministic: output ordering depends only on code-unit comparison of identities and the fixed
 * search -> lookup -> slice -> source family order, never on input order or object enumeration.
 */
export function buildRetrievalEvidence(input: BuildRetrievalEvidenceInput): RetrievalEvidenceV1 {
  const files: FileAccumulator = new Map();
  const symbols: SymbolAccumulator = new Map();
  const interpreted = new Map<RetrievalCommandFamily, RetrievalCommandEvidenceV1>();
  const duplicates: RetrievalCommandFamily[] = [];

  const ordered = RETRIEVAL_COMMAND_FAMILIES.flatMap((family) => input.commands.filter((command) => command.family === family));
  // Symbol attribution for source depends on structured evidence, so structured families run first (they do
  // by family order); source is last.
  for (const command of ordered) {
    if (interpreted.has(command.family)) {
      duplicates.push(command.family);
      continue;
    }
    let outcome: CommandInterpretation;
    if (!command.ok) {
      outcome = failedInterpretation("command-failed", REASON_COMMAND_FAILED);
    } else if (command.family === "source") {
      outcome = attributeSource(input.selection, interpreted.get("search")?.parseState === "parsed", files, symbols);
    } else {
      outcome = interpretStructured(command, files, symbols);
    }
    interpreted.set(command.family, {
      family: command.family,
      succeeded: command.ok,
      parseState: outcome.parseState,
      fileEvidenceCount: outcome.files.size,
      symbolEvidenceCount: outcome.symbolKeys.size,
      rejectedIdentityCount: outcome.rejected,
      ...(outcome.reason !== undefined ? { reason: outcome.reason } : {})
    });
  }

  const commands = RETRIEVAL_COMMAND_FAMILIES.flatMap((family) => {
    const entry = interpreted.get(family);
    return entry ? [entry] : [];
  });

  const fileEvidence: RetrievedFileEvidenceV1[] = [...files.entries()]
    .map(([path, provenance]) => ({ path, surfacedBy: orderedProvenance(provenance) }))
    .sort((left, right) => compareCodeUnits(left.path, right.path));
  const symbolEvidence: RetrievedSymbolEvidenceV1[] = [...symbols.values()]
    .map((symbol) => ({
      name: symbol.name,
      ...(symbol.nodeId !== undefined ? { nodeId: symbol.nodeId } : {}),
      ...(symbol.file !== undefined ? { file: symbol.file } : {}),
      surfacedBy: orderedProvenance(symbol.surfacedBy)
    }))
    .sort(
      (left, right) =>
        compareCodeUnits(left.file ?? "", right.file ?? "") ||
        compareCodeUnits(left.name, right.name) ||
        compareCodeUnits(left.nodeId ?? "", right.nodeId ?? "")
    );

  const search = interpreted.get("search");
  let availability: RetrievalEvidenceV1["availability"];
  let availabilityReason: string | undefined;
  if (commands.length === 0) {
    availability = "unavailable";
    availabilityReason = "no-retrieval-commands-executed";
  } else if (!search) {
    availability = "unavailable";
    availabilityReason = "search-command-not-executed";
  } else if (search.parseState !== "parsed") {
    availability = "unavailable";
    availabilityReason = "search-evidence-unavailable";
  } else if (duplicates.length > 0 || !commands.every(isFullyInterpreted)) {
    availability = "partial";
    availabilityReason = "some-executed-commands-were-not-fully-interpreted";
  } else {
    availability = "available";
  }

  return {
    schemaVersion: "retrieval-evidence-v1",
    availability,
    ...(availabilityReason !== undefined ? { availabilityReason } : {}),
    files: fileEvidence,
    symbols: symbolEvidence,
    commands: commands.map((entry) =>
      duplicates.includes(entry.family) && entry.reason === undefined ? { ...entry, reason: REASON_DUPLICATE } : entry
    )
  };
}

/**
 * Thin adapter from the lifecycle's measured commands to the pure builder. Only the four retrieval
 * families are considered; `index`, `version`, and any other command are ignored. Source stdout is dropped
 * here on purpose.
 */
export function buildRetrievalEvidenceFromCommands(
  commands: readonly Pick<MeasuredCommandResult, "commandId" | "ok" | "stdout">[],
  selection?: RetrievalEvidenceSelection
): RetrievalEvidenceV1 {
  const inputs: RetrievalEvidenceCommandInput[] = [];
  for (const command of commands) {
    if (command.commandId === "source") {
      inputs.push({ family: "source", ok: command.ok });
    } else if (command.commandId === "search" || command.commandId === "lookup" || command.commandId === "slice") {
      inputs.push({ family: command.commandId, ok: command.ok, stdout: command.stdout });
    }
  }
  return buildRetrievalEvidence({ commands: inputs, selection });
}
