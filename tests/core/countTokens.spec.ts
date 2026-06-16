import { describe, expect, it } from "vitest";
import { countEstimatedTokens, countTextChars, tokenCountMethod } from "../../src/core/countTokens.js";

describe("countTokens", () => {
  it("empty string returns 0", () => {
    expect(countTextChars("")).toBe(0);
    expect(countEstimatedTokens("")).toBe(0);
  });

  it("short string returns expected ceil chars divided by 4", () => {
    expect(countEstimatedTokens("abcd")).toBe(1);
    expect(countEstimatedTokens("abcde")).toBe(2);
  });

  it("multiline string is counted deterministically", () => {
    const text = "a\nbc\ndef";
    expect(countTextChars(text)).toBe(8);
    expect(countEstimatedTokens(text)).toBe(2);
  });

  it("tokenCountMethod is estimated_chars_div_4", () => {
    expect(tokenCountMethod).toBe("estimated_chars_div_4");
  });
});
