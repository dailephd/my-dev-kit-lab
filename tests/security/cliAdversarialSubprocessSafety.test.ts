import { describe, expect, it } from "vitest";
import { getAdversarialCliTarget } from "../../src/securityValidation/cliAdversarial/adversarialCliConfig.js";
import {
  DOT_LABEL_TEST_CASES,
  checkDotLabelEscaping,
  checkSubprocessNoShellInterpolation,
  escapeDotLabel,
} from "../../src/securityValidation/cliAdversarial/subprocessSafetyChecks.js";

// ---------------------------------------------------------------------------
// DOT label escaping — pure logic tests
// ---------------------------------------------------------------------------

describe("CLI adversarial subprocess safety — DOT label escaping logic", () => {
  it("escapeDotLabel escapes double quotes with a backslash prefix", () => {
    const raw = 'foo"bar';
    const escaped = escapeDotLabel(raw);
    // The escaped form contains \" (backslash + quote), making it safe in DOT "..." labels.
    expect(escaped).toContain('\\"');
    // Verify the escaped result is different from the raw input (transformation occurred).
    expect(escaped).not.toBe(raw);
  });

  it("escapeDotLabel escapes backslashes before other characters", () => {
    const raw = "foo\\bar";
    const escaped = escapeDotLabel(raw);
    expect(escaped).toContain("\\\\");
  });

  it("escapeDotLabel escapes newlines", () => {
    const raw = "foo\nbar";
    const escaped = escapeDotLabel(raw);
    expect(escaped).not.toContain("\n");
    expect(escaped).toContain("\\n");
  });

  it("escapeDotLabel prefixes angle brackets with backslash for record-label safety", () => {
    const raw = "foo<bar>";
    const escaped = escapeDotLabel(raw);
    // DOT record labels treat < > as special; the escaper prefixes them with \.
    expect(escaped).toContain("\\<");
    expect(escaped).toContain("\\>");
    expect(escaped).not.toBe(raw);
  });

  it("escapeDotLabel prefixes curly braces with backslash for record-label safety", () => {
    const raw = "foo{bar}";
    const escaped = escapeDotLabel(raw);
    expect(escaped).toContain("\\{");
    expect(escaped).toContain("\\}");
    expect(escaped).not.toBe(raw);
  });

  it("escapeDotLabel prefixes pipe with backslash for record-label safety", () => {
    const raw = "foo|bar";
    const escaped = escapeDotLabel(raw);
    expect(escaped).toContain("\\|");
    expect(escaped).not.toBe(raw);
  });

  it("escapeDotLabel is idempotent on safe strings", () => {
    const safe = "safe_identifier_123";
    expect(escapeDotLabel(safe)).toBe(safe);
  });

  it("DOT_LABEL_TEST_CASES covers all expected special characters", () => {
    const ids = DOT_LABEL_TEST_CASES.map((c) => c.id);
    expect(ids).toContain("double-quote");
    expect(ids).toContain("backslash");
    expect(ids).toContain("angle-brackets");
    expect(ids).toContain("curly-braces");
    expect(ids).toContain("pipe");
    expect(ids).toContain("newline");
  });
});

// ---------------------------------------------------------------------------
// DOT label escaping check
// ---------------------------------------------------------------------------

describe("CLI adversarial subprocess safety — checkDotLabelEscaping", () => {
  it("DOT label escaping check passes for all test cases", async () => {
    const result = await checkDotLabelEscaping();

    expect(result.id).toBe("graphviz-label-escaping");
    expect(result.status).toBe("passed");
    expect(result.findings).toHaveLength(0);
  });

  it("result has expected metadata", async () => {
    const result = await checkDotLabelEscaping();

    expect(result.category).toBe("cli-adversarial");
    expect(result.severity).toBe("major");
    expect(result.startedAt).toBeTruthy();
    expect(result.finishedAt).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Shell interpolation check
// ---------------------------------------------------------------------------

describe("CLI adversarial subprocess safety — shell interpolation", () => {
  it("paths with shell metacharacters do not trigger injection", async () => {
    const target = getAdversarialCliTarget();
    const result = await checkSubprocessNoShellInterpolation(target);

    expect(result.id).toBe("subprocess-no-shell-interpolation");
    expect(result.status).toBe("passed");
    expect(result.findings.filter((f) => f.id.startsWith("shell-injection"))).toHaveLength(0);
  });

  it("result is a blocker-severity check", async () => {
    const target = getAdversarialCliTarget();
    const result = await checkSubprocessNoShellInterpolation(target);

    expect(result.severity).toBe("blocker");
  });

  it("no unexpected writes outside workspace from metachar paths", async () => {
    const target = getAdversarialCliTarget();
    const result = await checkSubprocessNoShellInterpolation(target);

    const outsideFindings = result.findings.filter((f) =>
      f.id.startsWith("shell-injection-outside")
    );
    expect(outsideFindings).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Result format
// ---------------------------------------------------------------------------

describe("CLI adversarial subprocess safety — SecurityCheckResult format", () => {
  it("subprocess safety check results have required fields", async () => {
    const target = getAdversarialCliTarget();
    const results = await Promise.all([
      checkSubprocessNoShellInterpolation(target),
      checkDotLabelEscaping(),
    ]);

    for (const result of results) {
      expect(typeof result.id).toBe("string");
      expect(typeof result.name).toBe("string");
      expect(result.category).toBe("cli-adversarial");
      expect(["passed", "failed", "warning", "skipped"]).toContain(result.status);
      expect(Array.isArray(result.findings)).toBe(true);
    }
  });
});
