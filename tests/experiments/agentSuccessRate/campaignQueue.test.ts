import { describe, expect, it } from "vitest";
import { buildCampaignQueue } from "../../../src/experiments/plugins/agentSuccessRate/campaignQueue.js";
import { selectAgentSuccessTasks } from "../../../src/experiments/plugins/agentSuccessRate/execution.js";
import { AGENT_SUCCESS_RATE_TREATMENT_IDS } from "../../../src/experiments/plugins/agentSuccessRate/metadata.js";
import { makeTask } from "./agentSuccessRateTestHelpers.js";

describe("deterministic campaign queue", () => {
  const tasks = [makeTask({ id: "z-last-alphabetically" }), makeTask({ id: "a-first-alphabetically" }), makeTask({ id: "m-middle" })];
  it("QUEUE-ORDER / TREATMENT-ORDER preserve existing selection and pair ordering", () => {
    const selected = selectAgentSuccessTasks(tasks, { caseIds: ["a-first-alphabetically", "z-last-alphabetically"] });
    expect(buildCampaignQueue(selected, AGENT_SUCCESS_RATE_TREATMENT_IDS, "all-selected-cases").map((u) => [u.task.id, u.treatmentId, u.checkpointIndex])).toEqual([
      [tasks[0]!.id, "raw-full-file", 0], [tasks[0]!.id, "context-pack", 1], [tasks[1]!.id, "raw-full-file", 2], [tasks[1]!.id, "context-pack", 3]
    ]);
  });
  it("ONE-CASE keeps both treatments and excludes every later case", () => {
    expect(buildCampaignQueue(tasks, AGENT_SUCCESS_RATE_TREATMENT_IDS, "one-case").map((u) => [u.task.id, u.treatmentId])).toEqual([[tasks[0]!.id, "raw-full-file"], [tasks[0]!.id, "context-pack"]]);
  });
  it("rejects empty, invalid, duplicate selections and changed fixed treatments", () => {
    expect(() => buildCampaignQueue([], AGENT_SUCCESS_RATE_TREATMENT_IDS, "one-case")).toThrow("INVALID_SELECTION");
    expect(() => buildCampaignQueue([tasks[0]!, tasks[0]!], AGENT_SUCCESS_RATE_TREATMENT_IDS, "one-case")).toThrow("INVALID_SELECTION");
    expect(() => buildCampaignQueue(tasks, ["context-pack", "raw-full-file"], "one-case")).toThrow("FIXED_TREATMENTS_REQUIRED");
    expect(() => buildCampaignQueue(tasks, ["raw-full-file"], "one-case")).toThrow("FIXED_TREATMENTS_REQUIRED");
    expect(() => buildCampaignQueue(tasks, AGENT_SUCCESS_RATE_TREATMENT_IDS, "unknown" as "one-case")).toThrow("INVALID_EXECUTION_LIMIT");
  });
});
