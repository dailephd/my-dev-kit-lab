// Dispatches the incremental-change-staleness plugin report by the persisted execution artifact's
// schemaVersion: V1 artifacts keep the released V1 report semantics untouched (the V1 builder is called
// as-is), V2 artifacts select the four-treatment V2 model. Historical V1 evidence is never converted.

import { readFileSync } from "node:fs";
import type { ExperimentRun } from "../../experiments/index.js";
import {
  INCREMENTAL_CHANGE_STALENESS_EXECUTION_SCHEMA_VERSION
} from "../../experiments/plugins/incrementalChangeStaleness/executionArtifact.js";
import {
  INCREMENTAL_CHANGE_STALENESS_EXECUTION_SCHEMA_VERSION_V2,
  type IncrementalChangeStalenessExecutionArtifactV2
} from "../../experiments/plugins/incrementalChangeStaleness/executionArtifactV2.js";
import { INCREMENTAL_CHANGE_STALENESS_PLUGIN_ID } from "../../experiments/plugins/incrementalChangeStaleness/plugin.js";
import { buildIncrementalChangeStalenessReport, readArtifactPath } from "./buildIncrementalChangeStalenessReport.js";
import { buildIncrementalChangeStalenessReportV2FromArtifact } from "./buildIncrementalChangeStalenessReportV2.js";
import type { IncrementalChangeStalenessReportV1 } from "./incrementalChangeStalenessReportModel.js";
import type { IncrementalChangeStalenessReportV2 } from "./incrementalChangeStalenessReportModelV2.js";

export type IncrementalChangeStalenessPluginReport = IncrementalChangeStalenessReportV1 | IncrementalChangeStalenessReportV2;

export function buildIncrementalChangeStalenessPluginReport(run: ExperimentRun): IncrementalChangeStalenessPluginReport | null {
  if (run.pluginId !== INCREMENTAL_CHANGE_STALENESS_PLUGIN_ID) return null;
  const artifactPath = readArtifactPath(run);
  if (!artifactPath) return buildIncrementalChangeStalenessReport(run); // throws the established missing-path error

  let schemaVersion: unknown;
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(artifactPath, "utf8"));
    schemaVersion = (parsed as { schemaVersion?: unknown } | null)?.schemaVersion;
  } catch {
    // Unreadable or malformed: the V1 builder owns the established, explicit error messages.
    return buildIncrementalChangeStalenessReport(run);
  }
  if (schemaVersion === INCREMENTAL_CHANGE_STALENESS_EXECUTION_SCHEMA_VERSION_V2) {
    return buildIncrementalChangeStalenessReportV2FromArtifact(parsed as IncrementalChangeStalenessExecutionArtifactV2);
  }
  if (schemaVersion === INCREMENTAL_CHANGE_STALENESS_EXECUTION_SCHEMA_VERSION) {
    return buildIncrementalChangeStalenessReport(run);
  }
  throw new Error(`Invalid incremental-change-staleness report source: unsupported execution artifact schema version ${String(schemaVersion)}.`);
}
