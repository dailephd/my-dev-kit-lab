import { excerptGitFailure, runSandboxGit, type BenchmarkSandbox } from "../benchmarkSandbox/index.js";
import { extractPatchCandidate } from "./extractPatchCandidate.js";
import { parseUnifiedDiff } from "./parseUnifiedDiff.js";
import { DEFAULT_PATCH_BOUNDS, type PatchApplicationResult, type PatchBounds } from "./patchTypes.js";
import { validatePatchPolicy } from "./validatePatchPolicy.js";

export type ApplyPatchOptions = {
  sandbox: BenchmarkSandbox;
  /** Raw agent output: a fenced diff/patch block or a raw unified diff. */
  rawProposal: string;
  /** From the task contract; a patch touching any of these is rejected before Git sees it. */
  protectedFiles: readonly string[];
  bounds?: Readonly<PatchBounds>;
};

const APPLY_FLAGS = ["--index", "--whitespace=nowarn", "-"] as const;

/**
 * Lab-owned patch application. The order is the safety contract:
 * extract exactly one candidate -> parse -> policy -> `git apply --check --index` -> `git apply --index`.
 * Nothing touches the sandbox until the check succeeds, so every earlier failure leaves it unchanged.
 * `--unsafe-paths`, `--reject` and `--3way` are never used, and nothing the agent proposed is executed.
 */
export async function applyPatchToSandbox(options: ApplyPatchOptions): Promise<PatchApplicationResult> {
  const bounds = options.bounds ?? DEFAULT_PATCH_BOUNDS;

  const extracted = extractPatchCandidate(options.rawProposal, bounds);
  if (!extracted.ok) return { outcome: "parse-failure", code: extracted.code, message: extracted.message };

  const parsed = parseUnifiedDiff(extracted.patch);
  if (!parsed.ok) return { outcome: "parse-failure", code: parsed.code, message: parsed.message };

  const policy = validatePatchPolicy(parsed.files, { protectedFiles: options.protectedFiles, bounds });
  if (!policy.ok) return { outcome: "policy-rejection", rejections: policy.rejections };

  const check = await runSandboxGit(options.sandbox, ["apply", "--check", ...APPLY_FLAGS], {
    stdin: extracted.patch,
    label: "apply-check"
  });
  if (!check.ok) return { outcome: "git-check-failure", message: excerptGitFailure(check) };

  const apply = await runSandboxGit(options.sandbox, ["apply", ...APPLY_FLAGS], {
    stdin: extracted.patch,
    label: "apply"
  });
  if (!apply.ok) return { outcome: "git-apply-failure", message: excerptGitFailure(apply) };

  return { outcome: "success", files: policy.files };
}
