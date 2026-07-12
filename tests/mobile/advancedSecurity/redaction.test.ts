import { describe, expect, it } from "vitest";
import { fingerprintCandidateValue, redactedPreviewForCandidate } from "../../../src/mobile/android/advancedSecurity/redaction.js";

const LONG_TOKEN = "sk-FAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKE1234567890";
const SHORT_TOKEN = "abc123";
const MULTILINE_KEY = "-----BEGIN PRIVATE KEY-----\nMIIFAKEFAKEFAKE\nMIIFAKEFAKEFAKE\n-----END PRIVATE KEY-----";
const UNICODE_VALUE = "パスワード🔑1234567890abcdef";
const BINARY_LIKE = "\x00\x01\x02\x03binary\x1b[31mred\x1b[0mtext";

// ANDROID-V041-B1-05 — redaction never exposes the raw value.
describe("redactedPreviewForCandidate — non-disclosure", () => {
  it("never returns the full long token", () => {
    const preview = redactedPreviewForCandidate(LONG_TOKEN);
    expect(preview).not.toBe(LONG_TOKEN);
    expect(preview).not.toContain(LONG_TOKEN);
  });

  it("masks a short token entirely rather than showing prefix+suffix that reconstructs most of it", () => {
    const preview = redactedPreviewForCandidate(SHORT_TOKEN);
    expect(preview).toBe("***");
  });

  it("handles empty string distinctly from unavailable input", () => {
    expect(redactedPreviewForCandidate("")).toBe("[empty]");
    expect(redactedPreviewForCandidate(undefined)).toBe("[unavailable]");
    expect(redactedPreviewForCandidate("")).not.toBe(redactedPreviewForCandidate(undefined));
  });

  it("handles multiline private-key-like text without leaking the body", () => {
    const preview = redactedPreviewForCandidate(MULTILINE_KEY);
    expect(preview).not.toContain("MIIFAKEFAKEFAKE");
    expect(preview).not.toContain("\n");
  });

  it("handles unicode input safely and boundedly", () => {
    const preview = redactedPreviewForCandidate(UNICODE_VALUE);
    expect(preview.length).toBeLessThanOrEqual(UNICODE_VALUE.length + 10);
    expect(preview).not.toBe(UNICODE_VALUE);
  });

  it("strips unsafe control/ANSI bytes from binary-like input", () => {
    const preview = redactedPreviewForCandidate(BINARY_LIKE);
    // eslint-disable-next-line no-control-regex
    expect(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(preview)).toBe(false);
    expect(preview).not.toContain("\x1b[31m");
  });

  it("bounds preview length for very long input", () => {
    const veryLong = "a".repeat(5000);
    const preview = redactedPreviewForCandidate(veryLong);
    expect(preview.length).toBeLessThan(200);
  });

  it("is deterministic for equivalent input", () => {
    expect(redactedPreviewForCandidate(LONG_TOKEN)).toBe(redactedPreviewForCandidate(LONG_TOKEN));
  });
});

// ANDROID-V041-B1-06 — stable non-reversible fingerprint.
describe("fingerprintCandidateValue", () => {
  it("produces the same fingerprint for equivalent input", () => {
    expect(fingerprintCandidateValue(LONG_TOKEN)).toBe(fingerprintCandidateValue(LONG_TOKEN));
  });

  it("produces a different fingerprint for different input", () => {
    expect(fingerprintCandidateValue(LONG_TOKEN)).not.toBe(fingerprintCandidateValue(SHORT_TOKEN));
  });

  it("never embeds the raw input in the fingerprint", () => {
    expect(fingerprintCandidateValue(LONG_TOKEN)).not.toContain(LONG_TOKEN);
  });

  it("distinguishes unavailable input from an empty literal", () => {
    expect(fingerprintCandidateValue(undefined)).toBe("unavailable");
    expect(fingerprintCandidateValue("")).not.toBe("unavailable");
  });

  it("uses a stable sha256-prefixed format", () => {
    expect(fingerprintCandidateValue("x")).toMatch(/^sha256:[0-9a-f]{64}$/);
  });
});

// ANDROID-V041-B1-07 — no secret leaks through thrown errors. Neither
// function ever throws for these inputs; assert that directly rather than
// asserting on a caught error's message (there is none to catch).
describe("redaction helpers never throw for adversarial input", () => {
  it.each([LONG_TOKEN, SHORT_TOKEN, MULTILINE_KEY, UNICODE_VALUE, BINARY_LIKE, "", undefined])(
    "does not throw for %s",
    (input) => {
      expect(() => redactedPreviewForCandidate(input)).not.toThrow();
      expect(() => fingerprintCandidateValue(input)).not.toThrow();
    }
  );
});
