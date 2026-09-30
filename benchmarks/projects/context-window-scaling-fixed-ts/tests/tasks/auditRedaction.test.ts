import { describe, expect, it } from "vitest";
import { maskEmail, redactAuditEntry } from "../../src/tasks/auditRedaction.js";

describe("auditRedaction", () => {
  it("masks the email local part and redacts tokens", () => {
    expect(redactAuditEntry({ actor: "ana", action: "login", email: "ana@example.com", token: "abc" })).toEqual({
      actor: "ana",
      action: "login",
      email: "a***@example.com",
      token: "[redacted]"
    });
  });

  it("flags malformed emails", () => {
    expect(maskEmail("not-an-email")).toBe("[invalid-email]");
  });
});
