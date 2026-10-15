import { mkdir, realpath, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { loadPromptComparisonSide } from "../report/experiments/promptTemplateComparisonEvidence.js";
import {
  buildPromptTemplateComparison,
  PROMPT_TEMPLATE_COMPARISON_HTML_FILE,
  PROMPT_TEMPLATE_COMPARISON_JSON_FILE,
  PROMPT_TEMPLATE_COMPARISON_TEXT_FILE,
  type PromptTemplateComparisonReportV1
} from "../report/experiments/promptTemplateComparisonModel.js";
import {
  renderPromptTemplateComparisonHtml,
  renderPromptTemplateComparisonJson,
  renderPromptTemplateComparisonText
} from "../report/experiments/renderPromptTemplateComparison.js";

export type ParsedComparePromptsArgs = { baseline: string; candidate: string; out: string };

const FLAGS = ["--baseline", "--candidate", "--out"] as const;

/** Exactly --baseline, --candidate and --out, each once. Unknown flags, positional arguments and empty values are rejected. */
export function parseComparePromptsArgs(argv: string[]): ParsedComparePromptsArgs {
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index] as string;
    if (!(FLAGS as readonly string[]).includes(arg)) {
      throw new Error(arg.startsWith("--") ? `Unknown option for report compare-prompts: ${arg}` : `Unexpected argument for report compare-prompts: ${arg}`);
    }
    if (values.has(arg)) throw new Error(`Duplicate option: ${arg}`);
    const value = argv[index + 1];
    if (value === undefined || value.trim() === "" || value.startsWith("--")) throw new Error(`${arg} requires a non-empty path.`);
    values.set(arg, value);
    index += 1;
  }
  for (const flag of FLAGS) {
    if (!values.has(flag)) throw new Error(`Missing required option: ${flag}. Usage: report compare-prompts --baseline <run-root> --candidate <run-root> --out <output-root>`);
  }
  return { baseline: values.get("--baseline") as string, candidate: values.get("--candidate") as string, out: values.get("--out") as string };
}

/** Physical path of the nearest existing ancestor plus the not-yet-existing remainder. */
async function physicalPath(candidate: string): Promise<string> {
  let existing = path.resolve(candidate);
  const remainder: string[] = [];
  for (;;) {
    try {
      const real = await realpath(existing);
      return path.join(real, ...remainder);
    } catch {
      const parent = path.dirname(existing);
      if (parent === existing) return path.resolve(candidate);
      remainder.unshift(path.basename(existing));
      existing = parent;
    }
  }
}

function overlaps(a: string, b: string): boolean {
  const key = (value: string): string => (process.platform === "win32" ? value.toLowerCase() : value);
  const ra = path.relative(key(a), key(b));
  const rb = path.relative(key(b), key(a));
  const inside = (relative: string): boolean => relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
  return inside(ra) || inside(rb);
}

export type ComparePromptsResult = { report: PromptTemplateComparisonReportV1; paths: { json: string; text: string; html: string } };

export async function runComparePrompts(args: ParsedComparePromptsArgs, cwd = process.cwd()): Promise<ComparePromptsResult> {
  const baselineRoot = path.resolve(cwd, args.baseline);
  const candidateRoot = path.resolve(cwd, args.candidate);
  const outRoot = path.resolve(cwd, args.out);
  const [physicalBaseline, physicalCandidate, physicalOut] = await Promise.all([baselineRoot, candidateRoot, outRoot].map(physicalPath));
  if (path.relative(process.platform === "win32" ? physicalBaseline.toLowerCase() : physicalBaseline, process.platform === "win32" ? physicalCandidate.toLowerCase() : physicalCandidate) === "") {
    throw new Error("The baseline and candidate run roots are identical; a comparison needs two distinct runs.");
  }
  if (overlaps(physicalOut, physicalBaseline) || overlaps(physicalOut, physicalCandidate)) {
    throw new Error("The output root must not overlap the baseline or candidate run root.");
  }
  try {
    if (!(await stat(physicalOut)).isDirectory()) throw new Error("The output root exists and is not a directory.");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }

  const [baseline, candidate] = await Promise.all([loadPromptComparisonSide(baselineRoot, "baseline"), loadPromptComparisonSide(candidateRoot, "candidate")]);
  for (const side of [baseline, candidate]) {
    if (side.execution === null) {
      throw new Error(`The ${side.role} run evidence is unreadable or invalid: ${side.unverifiable.join("; ")}`);
    }
  }
  const report = buildPromptTemplateComparison(baseline, candidate);
  await mkdir(physicalOut, { recursive: true });
  const paths = {
    json: path.join(physicalOut, PROMPT_TEMPLATE_COMPARISON_JSON_FILE),
    text: path.join(physicalOut, PROMPT_TEMPLATE_COMPARISON_TEXT_FILE),
    html: path.join(physicalOut, PROMPT_TEMPLATE_COMPARISON_HTML_FILE)
  };
  await writeFile(paths.json, renderPromptTemplateComparisonJson(report), "utf8");
  await writeFile(paths.text, renderPromptTemplateComparisonText(report), "utf8");
  await writeFile(paths.html, renderPromptTemplateComparisonHtml(report), "utf8");
  return { report, paths };
}

export async function runComparePromptsCommand(argv: string[]): Promise<number> {
  try {
    const result = await runComparePrompts(parseComparePromptsArgs(argv));
    const report = result.report;
    console.log(
      [
        `Comparison: ${report.comparison.status}`,
        `Matched units: ${report.cohort.matchedUnitCount}`,
        `Behavioral improvement: ${report.behavioralImprovement.status}`,
        `JSON: ${result.paths.json}`,
        `Text: ${result.paths.text}`,
        `HTML: ${result.paths.html}`
      ].join("\n")
    );
    return 0;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
}
