import { rm } from "node:fs/promises";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runExperimentDescribeCommandFromArgs } from "../../../src/commands/runExperimentDescribeCommand.js";
import { renderExperimentRunHelp } from "../../../src/cli/help.js";
import { runExperiment } from "../../../src/experiments/index.js";
import { resolveIncrementalChangeStalenessRunOwnedRoot } from "../../../src/experiments/plugins/incrementalChangeStaleness/plugin.js";
import { makeKitDir, makeRunOwnedRoot, readIndexArgsLog, repoRoot, writeIncrementalLifecycleFakeKit, expectCanonicalFilesUnchanged, expectNoIndexOutputInCanonicalProjects, type IncrementalFakeKitOptions } from "./lifecycleTestHelpers.js";

const tracked: string[] = [];
const runIds: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(tracked.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  for (const runId of runIds.splice(0)) {
    await rm(resolveIncrementalChangeStalenessRunOwnedRoot(repoRoot, runId), { recursive: true, force: true });
  }
  expectCanonicalFilesUnchanged();
  expectNoIndexOutputInCanonicalProjects();
});

let counter = 0;
async function runPlugin(kitOptions: IncrementalFakeKitOptions, caseIds = ["U1"]) {
  counter += 1;
  const runId = `ics-b4-${process.pid}-${Date.now()}-${counter}`;
  runIds.push(runId);
  const kit = writeIncrementalLifecycleFakeKit(makeKitDir(tracked), kitOptions);
  const run = await runExperiment({
    pluginId: "incremental-change-staleness",
    outputRoot: makeRunOwnedRoot(tracked, "ics-b4-out-"),
    config: { caseIds, kitCommand: kit.command },
    toolRoot: repoRoot,
    runId
  });
  return { run, kit };
}

function metricsOf(run: Awaited<ReturnType<typeof runPlugin>>["run"], variantId: string) {
  return run.cases[0].outcomes.find((outcome) => outcome.variantId === variantId)!.metrics;
}

describe("public four-treatment plugin outcomes and metrics", () => {
  it("exposes four outcomes per scenario, keeps the released metrics, and adds separately named upstream refresh metrics", async () => {
    const { run } = await runPlugin({});
    expect(run.status).toBe("completed");
    const outcomes = run.cases[0].outcomes;
    expect(outcomes.map((outcome) => outcome.variantId)).toEqual(["stale-index", "changed-files-refresh", "affected-neighborhood-refresh", "full-refresh"]);
    expect(outcomes.map((outcome) => outcome.metadata?.treatmentIntent)).toEqual([
      "my-dev-kit-no-refresh",
      "my-dev-kit-changed-files-refresh",
      "my-dev-kit-affected-neighborhood-refresh",
      "my-dev-kit-full-refresh"
    ]);
    const releasedIds = [
      "context-character-count",
      "context-estimated-token-count",
      "operation-duration-ms",
      "agent-correctness-score",
      "affected-neighborhood-changed-file-count",
      "affected-neighborhood-changed-symbol-count",
      "affected-neighborhood-node-count",
      "affected-neighborhood-edge-count",
      "affected-neighborhood-task-overlap-count",
      "affected-neighborhood-task-overlap-percent"
    ];
    for (const outcome of outcomes) {
      const ids = outcome.metrics.map((entry) => entry.id);
      for (const id of ids.filter((entry) => !entry.startsWith("upstream-refresh-"))) expect(releasedIds).toContain(id);
      expect(ids).toEqual(expect.arrayContaining(["context-character-count", "operation-duration-ms", "agent-correctness-score"]));
    }

    // No fabricated upstream metrics for the treatments that did not use an incremental refresh.
    expect(metricsOf(run, "stale-index").some((entry) => entry.id.startsWith("upstream-refresh-"))).toBe(false);
    expect(metricsOf(run, "full-refresh").some((entry) => entry.id.startsWith("upstream-refresh-"))).toBe(false);

    // changed-files applied: no neighborhood evidence upstream, so those metrics are absent (never zero).
    const changed = Object.fromEntries(metricsOf(run, "changed-files-refresh").filter((entry) => entry.id.startsWith("upstream-refresh-")).map((entry) => [entry.id, entry.value]));
    expect(changed).toEqual({
      "upstream-refresh-fresh-extraction-file-count": 1,
      "upstream-refresh-reused-file-count": 9,
      "upstream-refresh-forced-neighbor-reanalysis-file-count": 0
    });

    // affected-neighborhood applied: the full upstream family is present with the persisted values.
    const affected = Object.fromEntries(metricsOf(run, "affected-neighborhood-refresh").filter((entry) => entry.id.startsWith("upstream-refresh-")).map((entry) => [entry.id, entry.value]));
    expect(affected).toEqual({
      "upstream-refresh-fresh-extraction-file-count": 1,
      "upstream-refresh-reused-file-count": 9,
      "upstream-refresh-forced-neighbor-reanalysis-file-count": 0,
      "upstream-refresh-seed-file-count": 1,
      "upstream-refresh-seed-symbol-count": 2,
      "upstream-refresh-affected-node-count": 5,
      "upstream-refresh-affected-edge-count": 4
    });
    // The upstream family is distinct from the six Lab task-overlap metrics.
    expect(metricsOf(run, "affected-neighborhood-refresh").map((entry) => entry.id)).toEqual(
      expect.arrayContaining(["affected-neighborhood-node-count", "upstream-refresh-affected-node-count"])
    );

    // No categorical upstream fields become numeric metrics.
    const allIds = run.cases.flatMap((experimentCase) => experimentCase.outcomes.flatMap((outcome) => outcome.metrics.map((entry) => entry.id)));
    for (const forbidden of ["requested", "applied", "selection", "fallback-reason", "realization", "winner", "rank", "score-composite", "safety"]) {
      expect(allIds.some((id) => id.includes(forbidden))).toBe(false);
    }
    expect(run.metrics.map((entry) => entry.id).some((id) => /winner|best|safety|composite|rank/.test(id))).toBe(false);
  }, 120_000);

  it("maps a truthful fallback-full to metadata and a completed outcome, with distinct comparison metadata per treatment", async () => {
    const { run } = await runPlugin({ refresh: { "affected-neighborhood": "fallback" } });
    const affected = run.cases[0].outcomes.find((outcome) => outcome.variantId === "affected-neighborhood-refresh")!;
    expect(affected.status).toBe("completed");
    expect(affected.metadata).toEqual(
      expect.objectContaining({
        refreshKind: "incremental",
        refreshRealization: "FALLBACK_FULL",
        requestedScope: "affected-neighborhood",
        appliedScope: "full",
        selectionStatus: "fallback-full",
        fallbackReason: "seed-selection-unavailable",
        referenceComparisonClassification: "not-comparable-as-partial-refresh"
      })
    );
    // Fallback upstream evidence: fresh/reused/forced counts exist, null neighborhood counts do not.
    expect(affected.metrics.filter((entry) => entry.id.startsWith("upstream-refresh-")).map((entry) => entry.id)).toEqual([
      "upstream-refresh-fresh-extraction-file-count",
      "upstream-refresh-reused-file-count",
      "upstream-refresh-forced-neighbor-reanalysis-file-count"
    ]);
    const changed = run.cases[0].outcomes.find((outcome) => outcome.variantId === "changed-files-refresh")!;
    expect(changed.metadata).toEqual(expect.objectContaining({ refreshRealization: "APPLIED_PARTIAL" }));
    expect(changed.metadata).toHaveProperty("referenceComparisonClassification");
    expect(changed.metadata).not.toHaveProperty("staleRiskClassification");
    const stale = run.cases[0].outcomes.find((outcome) => outcome.variantId === "stale-index")!;
    expect(stale.metadata).toHaveProperty("staleRiskClassification");
    expect(stale.metadata).not.toHaveProperty("referenceComparisonClassification");
    const full = run.cases[0].outcomes.find((outcome) => outcome.variantId === "full-refresh")!;
    expect(full.metadata).not.toHaveProperty("staleRiskClassification");
    expect(full.metadata).not.toHaveProperty("referenceComparisonClassification");
    expect(run.metrics.find((entry) => entry.id === "incremental-change-staleness-affected-neighborhood-fallback-full-count")?.value).toBe(1);
    expect(run.metrics.find((entry) => entry.id === "incremental-change-staleness-changed-files-applied-partial-count")?.value).toBe(1);
  }, 120_000);

  it("uses the V2 lifecycle only: every baseline is an incremental bootstrap and no run also performs a V1 path", async () => {
    const { kit } = await runPlugin({});
    const args = readIndexArgsLog(kit.argsLogPath);
    expect(args).toHaveLength(7);
    expect(args.slice(0, 4).every((entry) => entry.includes("--incremental") && entry[entry.indexOf("--refresh-scope") + 1] === "changed-files")).toBe(true);
  }, 120_000);
});

describe("public command surface", () => {
  it("experiment describe exposes the four variants in fixed order and no external-target example", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    expect(await runExperimentDescribeCommandFromArgs(["--experiment", "incremental-change-staleness", "--json"])).toBe(0);
    const described = JSON.parse(log.mock.calls.map((call) => call.join(" ")).join("\n")) as {
      metadata: { supportedTargets: string[] };
      supportedVariants: string[];
      examples: string[];
    };
    expect(described.supportedVariants).toEqual(["stale-index", "changed-files-refresh", "affected-neighborhood-refresh", "full-refresh"]);
    expect(described.metadata.supportedTargets).toEqual(["self"]);
    expect(described.examples.some((example) => example.includes("--target"))).toBe(false);
  });

  it("still advertises an explicit --target example for plugins that support external targets", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    expect(await runExperimentDescribeCommandFromArgs(["--experiment", "warm-index-reuse", "--json"])).toBe(0);
    const described = JSON.parse(log.mock.calls.map((call) => call.join(" ")).join("\n")) as { examples: string[] };
    expect(described.examples.some((example) => example.includes("--target"))).toBe(true);
  });

  it("generic run help no longer implies every plugin accepts --target", () => {
    const help = renderExperimentRunHelp();
    expect(help).toContain("only for");
    expect(help).toContain("plugins that support external targets");
    expect(help).toContain("incremental-change-staleness");
    expect(help).toContain("reject an explicit external --target");
    expect(help).not.toContain("--refresh-scope");
  });

  it("still rejects an external target for the self-only plugin", async () => {
    counter += 1;
    const runId = `ics-b4-ext-${process.pid}-${counter}`;
    runIds.push(runId);
    const run = await runExperiment({
      pluginId: "incremental-change-staleness",
      targetPath: makeRunOwnedRoot(tracked, "ics-b4-external-"),
      outputRoot: makeRunOwnedRoot(tracked, "ics-b4-out-"),
      config: { caseIds: ["U1"] },
      toolRoot: repoRoot,
      runId
    });
    expect(run.status).toBe("failed");
    expect(run.failures[0].message).toContain("external --target is not supported");
  });
});
