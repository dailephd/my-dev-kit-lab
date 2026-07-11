import { describe, expect, it } from "vitest";
import { parseBackupRules } from "../../../../src/mobile/android/advancedSecurity/backupConfiguration/parseBackupRules.js";

// ANDROID-V041-B3-12 — legacy include/exclude parsing.
describe("parseBackupRules — full-backup-content", () => {
  it("parses include/exclude entries with domain, path, and requireFlags", () => {
    const result = parseBackupRules(
      `<full-backup-content><include domain="sharedpref" path="." /><exclude domain="database" path="cache.db" requireFlags="clientSideEncryption" /></full-backup-content>`
    );
    expect(result.state).toBe("parsed-full-backup-content");
    if (result.state !== "parsed-full-backup-content") throw new Error("expected parsed");
    expect(result.model.rules).toHaveLength(2);
    expect(result.model.rules[0]).toMatchObject({ kind: "include", domain: "sharedpref", path: "." });
    expect(result.model.rules[1]).toMatchObject({ kind: "exclude", domain: "database", path: "cache.db", requireFlagsRaw: "clientSideEncryption" });
  });

  it("flags a rule with a missing domain as malformed", () => {
    const result = parseBackupRules(`<full-backup-content><include path="." /></full-backup-content>`);
    if (result.state !== "parsed-full-backup-content") throw new Error("expected parsed");
    expect(result.model.rules[0].malformed).toBe(true);
  });

  it("flags an unsupported domain value distinctly from an undefined domain", () => {
    const result = parseBackupRules(`<full-backup-content><include domain="not-a-real-domain" path="." /></full-backup-content>`);
    if (result.state !== "parsed-full-backup-content") throw new Error("expected parsed");
    expect(result.model.rules[0].domain).toBeUndefined();
    expect(result.model.rules[0].domainRaw).toBe("not-a-real-domain");
    expect(result.model.rules[0].malformed).toBe(false);
  });
});

// ANDROID-V041-B3-13/14 — cloud-backup vs device-transfer separation.
describe("parseBackupRules — data-extraction-rules", () => {
  it("keeps cloud-backup and device-transfer rules separate", () => {
    const result = parseBackupRules(
      `<data-extraction-rules><cloud-backup><include domain="sharedpref" path="." /></cloud-backup><device-transfer><include domain="root" path="." /></device-transfer></data-extraction-rules>`
    );
    expect(result.state).toBe("parsed-data-extraction-rules");
    if (result.state !== "parsed-data-extraction-rules") throw new Error("expected parsed");
    expect(result.model.cloudBackup?.rules).toHaveLength(1);
    expect(result.model.deviceTransfer?.rules).toHaveLength(1);
    expect(result.model.cloudBackup?.rules[0].domain).toBe("sharedpref");
    expect(result.model.deviceTransfer?.rules[0].domain).toBe("root");
  });

  it("parses disableIfNoEncryptionCapabilities on cloud-backup", () => {
    const result = parseBackupRules(`<data-extraction-rules><cloud-backup disableIfNoEncryptionCapabilities="true"></cloud-backup></data-extraction-rules>`);
    if (result.state !== "parsed-data-extraction-rules") throw new Error("expected parsed");
    expect(result.model.cloudBackup?.disableIfNoEncryptionCapabilities).toBe(true);
  });
});

describe("parseBackupRules — malformed/unsupported input", () => {
  it("returns malformed-xml for unterminated markup without throwing", () => {
    expect(() => parseBackupRules(`<full-backup-content>`)).not.toThrow();
    expect(parseBackupRules(`<full-backup-content>`).state).toBe("malformed-xml");
  });

  it("returns unsupported-root for a non-backup root element", () => {
    const result = parseBackupRules(`<resources><string name="x">y</string></resources>`);
    expect(result.state).toBe("unsupported-root");
  });
});

describe("parseBackupRules — determinism", () => {
  it("produces equivalent output for repeated parses", () => {
    const xml = `<full-backup-content><include domain="sharedpref" path="." /></full-backup-content>`;
    expect(parseBackupRules(xml)).toEqual(parseBackupRules(xml));
  });
});
