import type {
  TutorialArtifactRecordV1,
  TutorialScenarioV1,
  TutorialStepResultV1
} from "./types.js";

/**
 * Markdown tutorial generation.
 *
 * Every word in the output comes from the scenario (title, description,
 * narration) or from the structured run results. Nothing is summarized,
 * rewritten or invented, and this module never parses subtitles or the manifest
 * to reconstruct content.
 */

export type RenderTutorialMarkdownOptions = {
  scenario: TutorialScenarioV1;
  steps: TutorialStepResultV1[];
  /** Screenshot artifact records keyed by screenshot id, as produced by the run. */
  screenshots: readonly TutorialArtifactRecordV1[];
};

export function renderTutorialMarkdown(options: RenderTutorialMarkdownOptions): string {
  const { scenario } = options;
  const stepById = new Map(scenario.steps.map((step) => [step.id, step]));
  const screenshotById = new Map(
    options.screenshots.filter((record) => record.id !== undefined).map((record) => [record.id as string, record])
  );

  const lines: string[] = [];
  lines.push(`# ${scenario.title}`);
  if (scenario.description !== undefined && scenario.description.trim().length > 0) {
    lines.push("");
    lines.push(scenario.description.trim());
  }

  let position = 0;
  for (const stepResult of options.steps) {
    // A not-run step never happened, so it is not presented as part of the
    // tutorial at all.
    if (stepResult.status === "not-run") {
      continue;
    }
    const step = stepById.get(stepResult.id);
    if (!step) {
      continue;
    }
    position += 1;

    lines.push("");
    lines.push(`## Step ${position}: ${step.id}`);
    lines.push("");
    lines.push(step.narration.trim());

    if (stepResult.status === "failed") {
      lines.push("");
      // Stated plainly from the run result; no troubleshooting advice is invented.
      lines.push(`**This step failed during execution.** ${stepResult.error ?? ""}`.trim());
    }

    const screenshotId = step.screenshot?.id;
    if (screenshotId !== undefined) {
      const record = screenshotById.get(screenshotId);
      if (record?.status === "written" && record.path !== undefined) {
        lines.push("");
        lines.push(`![${step.id}](${toMarkdownScreenshotLink(record.path)})`);
      }
    }
  }

  lines.push("");
  return `${lines.join("\n")}`;
}

/**
 * tutorial.md lives in `artifacts/` and screenshots live in `screenshots/`, both
 * directly beneath runRoot, so a run-root-relative screenshot path becomes a
 * `../`-prefixed sibling link. POSIX separators keep the document portable; an
 * absolute machine path is never written.
 */
export function toMarkdownScreenshotLink(runRelativePosixPath: string): string {
  const normalized = runRelativePosixPath.replace(/\\/g, "/").replace(/^\/+/, "");
  return `../${normalized}`;
}
