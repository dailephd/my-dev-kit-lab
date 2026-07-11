import type { AndroidDetectionResult } from "../../detection.js";
import type { AndroidCheckResult } from "../../validation/checkResult.js";
import type { GradleCommandExecutor } from "../../gradle/validate/executor.js";
import { auditAndroidSemgrep } from "./semgrep/checkResult.js";
import { auditAndroidOsv } from "./osv/checkResult.js";
import { auditAndroidLint } from "./androidLint/checkResult.js";
import { auditAndroidDependencyCheck } from "./dependencyCheck/checkResult.js";
import { normalizeAndroidExternalToolRequest, type AndroidExternalToolRequest, type ExternalToolExecutor } from "./types.js";

// ---------------------------------------------------------------------------
// v0.4.1 Batch 7 — deterministic multi-tool dispatcher.
//
// Executes only explicitly requested tools, sequentially, in the fixed
// Semgrep -> OSV -> Android Lint -> Dependency-Check order — never
// concurrently, never a caller-controlled order. This function is new,
// additive, standalone infrastructure: it is not called from
// validateAndroidTarget or any active orchestration, and Batch 8 decides
// how (or whether) to wire it into the CLI and reports.
// ---------------------------------------------------------------------------

export type RunRequestedAndroidExternalToolsOptions = {
  request: AndroidExternalToolRequest;
  detection: AndroidDetectionResult;
  executors: {
    semgrep?: ExternalToolExecutor;
    osv?: ExternalToolExecutor;
    androidLint?: GradleCommandExecutor;
    dependencyCheck?: ExternalToolExecutor;
  };
  javaAvailable?: boolean;
  lintTaskAvailable?: boolean;
};

export async function runRequestedAndroidExternalTools(options: RunRequestedAndroidExternalToolsOptions): Promise<AndroidCheckResult[]> {
  const normalized = normalizeAndroidExternalToolRequest(options.request);
  if (!normalized.ok) {
    throw new Error(normalized.error);
  }
  if (normalized.value.tools.length === 0) return [];

  const results: AndroidCheckResult[] = [];

  for (const toolId of normalized.value.tools) {
    if (toolId === "semgrep" && options.executors.semgrep) {
      results.push(await auditAndroidSemgrep({ targetRoot: normalized.value.targetRoot, artifactRoot: normalized.value.artifactRoot, executor: options.executors.semgrep }));
      continue;
    }
    if (toolId === "osv" && options.executors.osv) {
      results.push(
        await auditAndroidOsv({
          targetRoot: normalized.value.targetRoot,
          executor: options.executors.osv,
          networkPolicy: normalized.value.networkPolicy,
        })
      );
      continue;
    }
    if (toolId === "android-lint" && options.executors.androidLint) {
      results.push(
        await auditAndroidLint({
          targetRoot: normalized.value.targetRoot,
          detection: options.detection,
          executor: options.executors.androidLint,
          artifactRoot: normalized.value.artifactRoot,
          taskAvailable: options.lintTaskAvailable,
        })
      );
      continue;
    }
    if (toolId === "dependency-check" && options.executors.dependencyCheck) {
      results.push(
        await auditAndroidDependencyCheck({
          targetRoot: normalized.value.targetRoot,
          artifactRoot: normalized.value.artifactRoot,
          executor: options.executors.dependencyCheck,
          javaAvailable: options.javaAvailable,
        })
      );
    }
  }

  return results;
}
