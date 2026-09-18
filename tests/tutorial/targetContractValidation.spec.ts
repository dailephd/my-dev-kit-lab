import { describe, expect, it } from "vitest";
import {
  describeTargetIdMismatch,
  tutorialTargetIdsMatch,
  validateTutorialTargetContract
} from "../../src/tutorial/targetContractValidation.js";
import { minimalTargetContract } from "./tutorialTestHelpers.js";

function expectInvalid(value: unknown, fragment: string): void {
  const result = validateTutorialTargetContract(value, "target.json");
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("expected invalid");
  expect(result.errors.join("\n")).toContain(fragment);
}

describe("validateTutorialTargetContract", () => {
  it("accepts a valid target contract", () => {
    const result = validateTutorialTargetContract(minimalTargetContract());
    if (!result.ok) throw new Error(result.errors.join("\n"));
    expect(result.value.processes).toHaveLength(1);
  });

  it("rejects a missing schemaVersion", () => {
    const contract = minimalTargetContract();
    delete (contract as Record<string, unknown>).schemaVersion;
    expectInvalid(contract, "missing required schemaVersion");
  });

  it("rejects an unsupported schemaVersion", () => {
    expectInvalid(minimalTargetContract({ schemaVersion: "1.1.0" as never }), "unsupported schemaVersion");
    expectInvalid(minimalTargetContract({ schemaVersion: "2.0.0" as never }), "unsupported schemaVersion");
  });

  it("rejects an invalid target id", () => {
    expectInvalid(minimalTargetContract({ id: "" }), "id");
    expectInvalid(minimalTargetContract({ id: "Demo Target" }), "must match");
  });

  it("rejects a missing prepare command", () => {
    const contract = minimalTargetContract();
    delete (contract as Record<string, unknown>).prepare;
    expectInvalid(contract, "must declare a prepare command");
  });

  it("rejects an empty prepare executable", () => {
    expectInvalid(minimalTargetContract({ prepare: { executable: "  " } }), "non-empty executable");
  });

  it("rejects non-string arguments", () => {
    expectInvalid(
      minimalTargetContract({ prepare: { executable: "node", args: ["ok", 42 as never] } }),
      "expected a string"
    );
  });

  it("rejects non-string environment values", () => {
    expectInvalid(
      minimalTargetContract({ prepare: { executable: "node", env: { PORT: 3000 as never } } }),
      "expected a string value"
    );
  });

  it("rejects a contract with no managed processes", () => {
    expectInvalid(minimalTargetContract({ processes: [] }), "at least one managed process");
  });

  it("rejects duplicate process ids", () => {
    const process = minimalTargetContract().processes[0];
    expectInvalid(minimalTargetContract({ processes: [process, { ...process }] }), "duplicate process id");
  });

  it("rejects an invalid process cwd", () => {
    const process = { ...minimalTargetContract().processes[0], cwd: "anywhere" as never };
    expectInvalid(minimalTargetContract({ processes: [process] }), "contract-root, target-root");
  });

  it("rejects a non-loopback applicationUrl", () => {
    expectInvalid(minimalTargetContract({ applicationUrl: "http://example.com/" }), "loopback hostname");
    expectInvalid(minimalTargetContract({ applicationUrl: "http://10.0.0.5:3000/" }), "loopback hostname");
  });

  it("accepts every loopback form for applicationUrl", () => {
    for (const url of ["http://localhost:3000/", "http://127.0.0.1:3000/", "http://[::1]:3000/", "https://localhost:8443/"]) {
      const result = validateTutorialTargetContract(minimalTargetContract({ applicationUrl: url }));
      if (!result.ok) throw new Error(`${url}: ${result.errors.join("\n")}`);
    }
  });

  it("rejects an invalid applicationUrl protocol", () => {
    expectInvalid(minimalTargetContract({ applicationUrl: "file:///tmp/app" }), "http: or https:");
    expectInvalid(minimalTargetContract({ applicationUrl: "ftp://localhost/" }), "http: or https:");
    expectInvalid(minimalTargetContract({ applicationUrl: "not a url" }), "valid absolute URL");
  });

  it("rejects an invalid readiness declaration", () => {
    const base = minimalTargetContract().processes[0];
    expectInvalid(
      minimalTargetContract({ processes: [{ ...base, readiness: { kind: "tcp", url: "http://127.0.0.1:1/", timeoutMs: 10 } as never }] }),
      'expected "http"'
    );
    expectInvalid(
      minimalTargetContract({ processes: [{ ...base, readiness: { kind: "http", url: "http://example.com/", timeoutMs: 10 } }] }),
      "loopback hostname"
    );
    expectInvalid(
      minimalTargetContract({ processes: [{ ...base, readiness: { kind: "http", url: "http://127.0.0.1:1/", timeoutMs: 0 } }] }),
      "finite positive integer"
    );
  });

  it("rejects an unknown placeholder anywhere a placeholder is allowed", () => {
    for (const bad of ["{{cwd}}", "{{shell}}", "{{command}}", "{{javascript}}", "{{env:HOME}}"]) {
      expectInvalid(
        minimalTargetContract({ prepare: { executable: "node", args: [bad] } }),
        "unsupported placeholder"
      );
      expectInvalid(
        minimalTargetContract({ prepare: { executable: "node", env: { VALUE: bad } } }),
        "unsupported placeholder"
      );
    }
  });

  it("accepts {{targetRoot}} in prepare and process args and env", () => {
    const result = validateTutorialTargetContract(
      minimalTargetContract({
        prepare: { executable: "node", args: ["prepare.js", "{{targetRoot}}"], env: { OUT: "{{targetRoot}}/out" } },
        processes: [
          {
            id: "viewer",
            executable: "node",
            args: ["{{targetRoot}}/server.js"],
            env: { ROOT: "{{targetRoot}}" },
            readiness: { kind: "http", url: "http://127.0.0.1:3000/", timeoutMs: 5000 }
          }
        ]
      })
    );
    if (!result.ok) throw new Error(result.errors.join("\n"));
  });

  it("rejects a shell field", () => {
    expectInvalid(minimalTargetContract({ shell: true } as never), '"shell" is not supported');
    expectInvalid(
      minimalTargetContract({ prepare: { executable: "node", shell: true } as never }),
      '"shell" is not supported'
    );
  });

  it("rejects a commandString field and other execution escape hatches", () => {
    expectInvalid(minimalTargetContract({ commandString: "npm run x" } as never), '"commandString" is not supported');
    expectInvalid(minimalTargetContract({ script: "x.sh" } as never), '"script" is not supported');
    expectInvalid(minimalTargetContract({ javascript: "alert(1)" } as never), '"javascript" is not supported');
    expectInvalid(minimalTargetContract({ eval: "1+1" } as never), '"eval" is not supported');
  });
});

describe("tutorialTargetIdsMatch", () => {
  it("detects a scenario/target identity mismatch before execution", () => {
    expect(tutorialTargetIdsMatch("demo-target", "demo-target")).toBe(true);
    expect(tutorialTargetIdsMatch("observer-demo", "other-demo")).toBe(false);
    expect(describeTargetIdMismatch("observer-demo", "other-demo")).toBe(
      'Tutorial scenario targetId "observer-demo" does not match target contract id "other-demo".'
    );
  });
});
