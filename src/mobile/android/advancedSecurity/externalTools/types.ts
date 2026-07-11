import type { CommandExecutionResult } from "../../../../securityValidation/types.js";
import type { AndroidCheckResult } from "../../validation/checkResult.js";

// ---------------------------------------------------------------------------
// v0.4.1 Batch 7 — common contract for optional external Android
// security-tool evidence (Semgrep, OSV-Scanner, Android Lint,
// OWASP Dependency-Check).
//
// This module defines identities and request/result shapes only. No process
// ever executes because a type exists here. Every tool remains disconnected
// from validateAndroidTarget, the CLI, verdict calculation, and active
// reports until Batch 8 — see each adapter's checkResult.ts for the
// standalone AndroidCheckResult-compatible builder.
// ---------------------------------------------------------------------------

export const ANDROID_EXTERNAL_TOOL_IDS = ["semgrep", "osv", "android-lint", "dependency-check"] as const;
export type AndroidExternalSecurityToolId = (typeof ANDROID_EXTERNAL_TOOL_IDS)[number];

export function isAndroidExternalSecurityToolId(value: string): value is AndroidExternalSecurityToolId {
  return (ANDROID_EXTERNAL_TOOL_IDS as readonly string[]).includes(value);
}

// Deterministic dispatch order — never concurrent, never caller-controlled.
export const ANDROID_EXTERNAL_TOOL_ORDER: readonly AndroidExternalSecurityToolId[] = ["semgrep", "osv", "android-lint", "dependency-check"];

export const ANDROID_EXTERNAL_TOOL_NETWORK_POLICIES = ["deny", "allow-for-requested-tool"] as const;
export type AndroidExternalToolNetworkPolicy = (typeof ANDROID_EXTERNAL_TOOL_NETWORK_POLICIES)[number];

// A caller (Batch 8, or a test) explicitly opts every tool in by id. An
// empty or missing `requestedTools` list executes zero tools — there is no
// "run everything" default.
export type AndroidExternalToolRequest = {
  requestedTools: readonly string[];
  targetRoot: string;
  artifactRoot: string;
  networkPolicy?: AndroidExternalToolNetworkPolicy;
  timeoutOverrideMs?: number;
};

export type NormalizedAndroidExternalToolRequest = {
  tools: readonly AndroidExternalSecurityToolId[];
  targetRoot: string;
  artifactRoot: string;
  networkPolicy: AndroidExternalToolNetworkPolicy;
  timeoutOverrideMs?: number;
};

export type NormalizeRequestResult = { ok: true; value: NormalizedAndroidExternalToolRequest } | { ok: false; error: string };

const MIN_TIMEOUT_OVERRIDE_MS = 5_000;
const MAX_TIMEOUT_OVERRIDE_MS = 30 * 60_000;

// Deduplicates and orders requested tool ids deterministically, and rejects
// any id outside the closed ANDROID_EXTERNAL_TOOL_IDS union at this single
// contract boundary — no caller can smuggle an arbitrary tool identity past
// this point.
export function normalizeAndroidExternalToolRequest(request: AndroidExternalToolRequest | undefined): NormalizeRequestResult {
  if (!request || !Array.isArray(request.requestedTools) || request.requestedTools.length === 0) {
    return {
      ok: true,
      value: {
        tools: [],
        targetRoot: request?.targetRoot ?? "",
        artifactRoot: request?.artifactRoot ?? "",
        networkPolicy: request?.networkPolicy ?? "deny",
        timeoutOverrideMs: request?.timeoutOverrideMs,
      },
    };
  }

  const unknown = request.requestedTools.filter((id) => !isAndroidExternalSecurityToolId(id));
  if (unknown.length > 0) {
    return { ok: false, error: `Unknown external security tool id(s): ${unknown.join(", ")}` };
  }

  if (!request.targetRoot) return { ok: false, error: "targetRoot is required." };
  if (!request.artifactRoot) return { ok: false, error: "artifactRoot is required." };

  if (request.timeoutOverrideMs !== undefined) {
    if (request.timeoutOverrideMs < MIN_TIMEOUT_OVERRIDE_MS || request.timeoutOverrideMs > MAX_TIMEOUT_OVERRIDE_MS) {
      return { ok: false, error: `timeoutOverrideMs must be between ${MIN_TIMEOUT_OVERRIDE_MS} and ${MAX_TIMEOUT_OVERRIDE_MS}.` };
    }
  }

  const requestedSet = new Set(request.requestedTools as AndroidExternalSecurityToolId[]);
  const tools = ANDROID_EXTERNAL_TOOL_ORDER.filter((id) => requestedSet.has(id));

  return {
    ok: true,
    value: {
      tools,
      targetRoot: request.targetRoot,
      artifactRoot: request.artifactRoot,
      networkPolicy: request.networkPolicy ?? "deny",
      timeoutOverrideMs: request.timeoutOverrideMs,
    },
  };
}

// ---------------------------------------------------------------------------
// Executor contract — mirrors the existing GradleCommandExecutor injection
// pattern (src/mobile/android/gradle/validate/executor.ts) so every adapter
// is testable with a fake executor and never needs a real binary installed.
// ---------------------------------------------------------------------------

export type ExternalToolCommandInput = {
  command: string;
  args: string[];
  cwd: string;
  timeoutMs: number;
  env: NodeJS.ProcessEnv;
};

export type ExternalToolExecutor = (input: ExternalToolCommandInput) => Promise<CommandExecutionResult>;

// ---------------------------------------------------------------------------
// Artifact references — Batch 7 introduces this concept new (no existing
// owner copies/hashes generated tool output); Batch 8 decides where active
// reports place these.
// ---------------------------------------------------------------------------

export const ANDROID_EXTERNAL_TOOL_ARTIFACT_KINDS = ["json", "xml", "sarif", "text"] as const;
export type AndroidExternalToolArtifactKind = (typeof ANDROID_EXTERNAL_TOOL_ARTIFACT_KINDS)[number];

export const ANDROID_EXTERNAL_TOOL_PARSE_STATUSES = ["parsed", "malformed", "truncated", "not-attempted"] as const;
export type AndroidExternalToolParseStatus = (typeof ANDROID_EXTERNAL_TOOL_PARSE_STATUSES)[number];

export type AndroidExternalToolArtifactReference = {
  toolId: AndroidExternalSecurityToolId;
  artifactKind: AndroidExternalToolArtifactKind;
  relativePath: string;
  mediaType: string;
  sizeBytes: number;
  sha256: string;
  generatedByThisRun: boolean;
  copiedFromTarget: boolean;
  sourceTargetRelativePath?: string;
  truncated: boolean;
  parseStatus: AndroidExternalToolParseStatus;
};

// ---------------------------------------------------------------------------
// Common per-tool execution result — every adapter's checkResult.ts folds
// this (plus tool-specific findings/candidates) into a standalone
// AndroidCheckResult, exactly as the existing Gradle operations fold a
// CommandExecutionResult via buildGradleOperationCheckResult.
// ---------------------------------------------------------------------------

export const ANDROID_EXTERNAL_TOOL_STATUSES = [
  "not-requested",
  "skipped",
  "completed-without-findings",
  "completed-with-findings",
  "inconclusive",
  "failed",
] as const;
export type AndroidExternalToolStatus = (typeof ANDROID_EXTERNAL_TOOL_STATUSES)[number];

export type AndroidExternalToolExecutionResult = {
  toolId: AndroidExternalSecurityToolId;
  requested: boolean;
  available: boolean;
  executed: boolean;
  status: AndroidExternalToolStatus;
  version?: string;
  rawVersionSummary?: string;
  executableIdentity?: string;
  commandSummary: string;
  workingDirectory: string;
  networkPolicy: AndroidExternalToolNetworkPolicy;
  durationMs: number;
  exitCode: number | null;
  timedOut: boolean;
  stdoutTruncated: boolean;
  stderrTruncated: boolean;
  artifacts: AndroidExternalToolArtifactReference[];
  warnings: string[];
  errors: string[];
  skips: string[];
  mutationEvidence: { comparable: boolean; expectedGeneratedChanges: string[]; unexpectedChanges: string[] };
  limitations: string[];
};

export function notRequestedResult(toolId: AndroidExternalSecurityToolId, targetRoot: string, networkPolicy: AndroidExternalToolNetworkPolicy): AndroidExternalToolExecutionResult {
  return {
    toolId,
    requested: false,
    available: false,
    executed: false,
    status: "not-requested",
    commandSummary: "(not requested)",
    workingDirectory: targetRoot,
    networkPolicy,
    durationMs: 0,
    exitCode: null,
    timedOut: false,
    stdoutTruncated: false,
    stderrTruncated: false,
    artifacts: [],
    warnings: [],
    errors: [],
    skips: [],
    mutationEvidence: { comparable: true, expectedGeneratedChanges: [], unexpectedChanges: [] },
    limitations: [],
  };
}

export type { AndroidCheckResult };
