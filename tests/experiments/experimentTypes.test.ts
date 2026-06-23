import { describe, expect, it } from "vitest";
import {
  experimentRunStatuses,
  invalidExperimentConfig,
  summarizeExperimentRun,
  validExperimentConfig,
  type ExperimentPlugin,
  type ExperimentRun,
  type ExperimentTarget,
} from "../../src/experiments/index.js";

const target: ExperimentTarget = {
  kind: "self",
  targetRoot: process.cwd(),
  toolRoot: process.cwd(),
  packageName: "my-dev-kit-lab",
  packageVersion: "0.1.4",
  hasPackageJson: true,
  hasLockfile: true,
  branch: "feature/test",
  commit: "abc1234",
  hasGit: true,
  isSelf: true,
};

describe("experiment type helpers", () => {
  it("exposes the supported run statuses", () => {
    expect(experimentRunStatuses).toEqual([
      "completed",
      "partial",
      "failed",
      "skipped",
    ]);
  });

  it("represents the minimum plugin contract", () => {
    const plugin: ExperimentPlugin<{ dryRun: boolean }> = {
      metadata: {
        id: "contract-plugin",
        name: "Contract Plugin",
        description: "Validates the plugin contract shape.",
        schemaVersion: "1.0.0",
        status: "experimental",
        supportedTargets: ["self"],
        supportedOutputs: ["json"],
      },
      defaultConfig: { dryRun: true },
      validateConfig(config) {
        if (typeof config !== "object" || config === null) {
          return invalidExperimentConfig(["config must be an object"]);
        }
        return validExperimentConfig({ dryRun: true });
      },
      async run(context) {
        return {
          runId: context.runId,
          pluginId: "contract-plugin",
          startedAt: context.startedAt.toISOString(),
          status: "completed",
          target: context.target,
          variants: [],
          cases: [],
          metrics: [],
          artifacts: [],
          warnings: [],
          failures: [],
        };
      },
    };

    expect(plugin.metadata.id).toBe("contract-plugin");
    expect(plugin.validateConfig({}).valid).toBe(true);
    expect(plugin.validateConfig(null).errors).toContain("config must be an object");
  });

  it("summarizes completed, partial, failed, and skipped outcomes", () => {
    const run: ExperimentRun = {
      runId: "run-1",
      pluginId: "summary-plugin",
      startedAt: "2026-06-23T00:00:00.000Z",
      completedAt: "2026-06-23T00:00:01.000Z",
      status: "partial",
      target,
      variants: [],
      cases: [
        {
          id: "completed-case",
          name: "Completed case",
          outcomes: [
            {
              id: "completed-outcome",
              caseId: "completed-case",
              variantId: "variant-a",
              status: "completed",
              metrics: [],
              artifacts: [],
              warnings: [],
              failures: [],
            },
          ],
        },
        {
          id: "partial-case",
          name: "Partial case",
          outcomes: [
            {
              id: "partial-ok",
              caseId: "partial-case",
              variantId: "variant-a",
              status: "completed",
              metrics: [],
              artifacts: [],
              warnings: [],
              failures: [],
            },
            {
              id: "partial-failed",
              caseId: "partial-case",
              variantId: "variant-b",
              status: "failed",
              metrics: [],
              artifacts: [],
              warnings: [],
              failures: [{ code: "failed", message: "variant failed" }],
            },
          ],
        },
        {
          id: "failed-case",
          name: "Failed case",
          outcomes: [
            {
              id: "failed-outcome",
              caseId: "failed-case",
              variantId: "variant-a",
              status: "failed",
              metrics: [],
              artifacts: [],
              warnings: [],
              failures: [],
            },
          ],
        },
        { id: "skipped-case", name: "Skipped case", outcomes: [] },
      ],
      metrics: [],
      artifacts: [],
      warnings: [{ code: "run-warning", message: "warning" }],
      failures: [],
    };

    expect(summarizeExperimentRun(run)).toEqual(
      expect.objectContaining({
        status: "partial",
        totalCases: 4,
        completedCases: 1,
        partialCases: 1,
        failedCases: 1,
        skippedCases: 1,
        warnings: [{ code: "run-warning", message: "warning" }],
        failures: [{ code: "failed", message: "variant failed" }],
      })
    );
  });
});
