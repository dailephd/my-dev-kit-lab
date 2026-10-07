export type BenchmarkSandboxErrorCode =
  | "INVALID_SANDBOX_ID"
  | "CANONICAL_ROOT_INVALID"
  | "RUNTIME_OVERLAP"
  | "SANDBOX_EXISTS"
  | "SYMLINK_REJECTED"
  | "UNSUPPORTED_ENTRY"
  | "EMPTY_PROJECT"
  | "COPY_FAILED"
  | "COPY_MISMATCH"
  | "GIT_UNAVAILABLE"
  | "GIT_FAILED"
  | "BASELINE_NOT_CLEAN";

const MAX_MESSAGE_LENGTH = 500;

/** Bounded, typed failure of sandbox creation, baseline, or tree inspection. */
export class BenchmarkSandboxError extends Error {
  readonly code: BenchmarkSandboxErrorCode;

  constructor(code: BenchmarkSandboxErrorCode, message: string) {
    const bounded = message.length > MAX_MESSAGE_LENGTH ? `${message.slice(0, MAX_MESSAGE_LENGTH)}...` : message;
    super(`Benchmark sandbox error (${code}): ${bounded}`);
    this.name = "BenchmarkSandboxError";
    this.code = code;
  }
}
