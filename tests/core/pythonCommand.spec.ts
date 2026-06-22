import { describe, expect, it } from "vitest";
import { resolvePythonCommand } from "../../src/core/pythonCommand.js";

describe("resolvePythonCommand", () => {
  it("prefers py -3 on Windows when available", () => {
    const result = resolvePythonCommand({
      platform: "win32",
      probeAvailability: (candidate) => candidate.command === "py"
    });
    expect(result).toEqual({ command: "py", argsPrefix: ["-3"] });
  });

  it("falls back to python on Windows when py is unavailable", () => {
    const result = resolvePythonCommand({
      platform: "win32",
      probeAvailability: (candidate) => candidate.command === "python"
    });
    expect(result).toEqual({ command: "python", argsPrefix: [] });
  });

  it("prefers python3 on Unix-like platforms when available", () => {
    const result = resolvePythonCommand({
      platform: "linux",
      probeAvailability: (candidate) => candidate.command === "python3"
    });
    expect(result).toEqual({ command: "python3", argsPrefix: [] });
  });

  it("falls back to python when python3 is unavailable on Unix-like platforms", () => {
    const result = resolvePythonCommand({
      platform: "darwin",
      probeAvailability: (candidate) => candidate.command === "python"
    });
    expect(result).toEqual({ command: "python", argsPrefix: [] });
  });

  it("returns the first platform candidate when probing finds nothing", () => {
    expect(
      resolvePythonCommand({
        platform: "win32",
        probeAvailability: () => false
      })
    ).toEqual({ command: "py", argsPrefix: ["-3"] });
  });
});
