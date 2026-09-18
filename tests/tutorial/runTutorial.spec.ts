import { createHash } from "node:crypto";
import { mkdtempSync, readdirSync, statSync, writeFileSync, mkdirSync } from "node:fs";
import { readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { BrowserLaunchResult } from "../../src/browser/index.js";
import { createLabExecutionContext } from "../../src/runtime/labExecutionContext.js";
import { runTutorial } from "../../src/tutorial/runTutorial.js";
import type { TutorialScenarioV1, TutorialTargetContractV1 } from "../../src/tutorial/types.js";
import { createFakeBrowser, createFakePage, type FakeBrowser, type FakePage } from "./tutorialTestHelpers.js";

const tempDirs: string[] = [];
afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function makeTempDir(prefix = "tutorial-run-"): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

const RUN_ID = "20260918t120000z-testrun1";

/**
 * A tutorial fixture is a contract directory holding the two JSON contracts plus
 * small Node scripts the contract names as its prepare command and processes.
 * Everything is real: real files, real child processes, real loopback HTTP.
 * Only the browser is faked.
 */
type Fixture = {
  contractRoot: string;
  scenarioPath: string;
  targetContractPath: string;
  outDir: string;
  invocationCwd: string;
  workspaceRoot: string;
};

const PREPARE_SCRIPT = `
const fs = require("node:fs");
const path = require("node:path");
const targetRoot = process.argv[2];
if (process.env.PREPARE_SHOULD_FAIL === "1") {
  console.error("prepare refused");
  process.exit(3);
}
if (process.env.PREPARE_SKIP_TARGET === "1") {
  console.log("prepared nothing");
  process.exit(0);
}
fs.mkdirSync(path.join(targetRoot, "out"), { recursive: true });
fs.writeFileSync(path.join(targetRoot, "out", "report.json"), JSON.stringify({ counts: { tasks: 3 } }), "utf8");
fs.writeFileSync(path.join(targetRoot, "server-marker.txt"), "ready", "utf8");
console.log("prepared " + targetRoot);
`;

const SERVER_SCRIPT = `
const http = require("node:http");
const port = Number(process.env.TUTORIAL_TEST_PORT || 0);
const server = http.createServer((req, res) => {
  if (req.url === "/api/status") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
    return;
  }
  res.writeHead(200, { "content-type": "text/html" });
  res.end("<html><body><h1>demo</h1></body></html>");
});
server.listen(port, "127.0.0.1", () => {
  console.log("listening on " + server.address().port);
});
`;

const NEVER_READY_SCRIPT = `setInterval(() => {}, 1000); console.log("alive but not listening");`;
const EXIT_EARLY_SCRIPT = `console.log("starting"); setTimeout(() => process.exit(4), 150);`;

function writeFixture(options: {
  scenario?: Partial<TutorialScenarioV1>;
  targetContract?: Partial<TutorialTargetContractV1>;
  port: number;
  processScript?: string;
  processEnv?: Record<string, string>;
  extraProcesses?: TutorialTargetContractV1["processes"];
}): Fixture {
  const contractRoot = makeTempDir("tutorial-contract-");
  const invocationCwd = makeTempDir("tutorial-cwd-");
  const workspaceRoot = makeTempDir("tutorial-workspace-");
  const outDir = path.join(makeTempDir("tutorial-out-"), "run");

  writeFileSync(path.join(contractRoot, "prepare.js"), PREPARE_SCRIPT, "utf8");
  writeFileSync(path.join(contractRoot, "server.js"), options.processScript ?? SERVER_SCRIPT, "utf8");

  const applicationUrl = `http://127.0.0.1:${options.port}/`;

  const scenario: TutorialScenarioV1 = {
    schemaVersion: "1.0.0",
    id: "demo-tutorial",
    title: "Demo tutorial",
    targetId: "demo-target",
    browser: { viewport: { width: 1280, height: 720 } },
    steps: [
      {
        id: "open",
        narration: "Open the demo.",
        action: { type: "goto", path: "/" },
        assertions: [
          { type: "file-exists", path: "out/report.json" },
          { type: "json-file-equals", path: "out/report.json", pointer: "/counts/tasks", expected: 3 },
          { type: "http-json-equals", path: "/api/status", pointer: "/ok", expected: true }
        ]
      }
    ],
    ...options.scenario
  } as TutorialScenarioV1;

  const targetContract: TutorialTargetContractV1 = {
    schemaVersion: "1.0.0",
    id: "demo-target",
    prepare: { executable: process.execPath, args: ["prepare.js", "{{targetRoot}}"] },
    processes: [
      {
        id: "viewer",
        executable: process.execPath,
        args: ["server.js"],
        cwd: "contract-root",
        env: { TUTORIAL_TEST_PORT: String(options.port), ...options.processEnv },
        readiness: { kind: "http", url: applicationUrl, timeoutMs: 10_000, intervalMs: 50 }
      },
      ...(options.extraProcesses ?? [])
    ],
    applicationUrl,
    ...options.targetContract
  } as TutorialTargetContractV1;

  const scenarioPath = path.join(contractRoot, "scenario.json");
  const targetContractPath = path.join(contractRoot, "target.json");
  writeFileSync(scenarioPath, JSON.stringify(scenario, null, 2), "utf8");
  writeFileSync(targetContractPath, JSON.stringify(targetContract, null, 2), "utf8");

  return { contractRoot, scenarioPath, targetContractPath, outDir, invocationCwd, workspaceRoot };
}

async function reservePort(): Promise<number> {
  const http = await import("node:http");
  const server = http.createServer(() => undefined);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const port = (server.address() as { port: number }).port;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

function context(fixture: Fixture) {
  return createLabExecutionContext({
    invocationCwd: fixture.invocationCwd,
    workspaceRoot: fixture.workspaceRoot
  });
}

function fakeLauncher(browser: FakeBrowser): () => Promise<BrowserLaunchResult> {
  return async () => ({ status: "launched", browser });
}

function snapshotDirectory(root: string): string {
  const entries: string[] = [];
  const walk = (dir: string, prefix: string): void => {
    for (const entry of readdirSync(dir).sort()) {
      const full = path.join(dir, entry);
      const relative = prefix ? `${prefix}/${entry}` : entry;
      const stats = statSync(full);
      if (stats.isDirectory()) {
        entries.push(`D ${relative}`);
        walk(full, relative);
      } else {
        entries.push(`F ${relative} ${stats.size}`);
      }
    }
  };
  walk(root, "");
  return createHash("sha256").update(entries.join("\n")).digest("hex");
}

describe("runTutorial - complete run", () => {
  it("prepares, starts processes, runs steps and passes", async () => {
    const port = await reservePort();
    const fixture = writeFixture({ port });
    const page: FakePage = createFakePage({ url: `http://127.0.0.1:${port}/` });
    const browser = createFakeBrowser({ page });

    const result = await runTutorial({
      scenarioPath: fixture.scenarioPath,
      targetContractPath: fixture.targetContractPath,
      context: context(fixture),
      outDir: fixture.outDir,
      launchBrowser: fakeLauncher(browser),
      generateRunId: () => RUN_ID
    });

    expect(result.status).toBe("passed");
    expect(result.scenarioId).toBe("demo-tutorial");
    expect(result.targetId).toBe("demo-target");
    expect(result.runId).toBe(RUN_ID);
    expect(result.steps).toHaveLength(1);
    expect(result.steps[0].status).toBe("passed");
    expect(result.steps[0].assertions.map((assertion) => assertion.status)).toEqual([
      "passed",
      "passed",
      "passed"
    ]);
    expect(result.cleanupErrors).toEqual([]);
    expect(browser.contextsCreated()).toBe(1);
    expect(browser.pagesCreated()).toBe(1);
  });

  it("runs prepare from contractRoot and expands {{targetRoot}}", async () => {
    const port = await reservePort();
    const fixture = writeFixture({ port });
    const browser = createFakeBrowser({ page: createFakePage({ url: `http://127.0.0.1:${port}/` }) });

    const result = await runTutorial({
      scenarioPath: fixture.scenarioPath,
      targetContractPath: fixture.targetContractPath,
      context: context(fixture),
      outDir: fixture.outDir,
      launchBrowser: fakeLauncher(browser),
      generateRunId: () => RUN_ID
    });

    expect(result.status).toBe("passed");
    // prepare.js is only resolvable when the working directory is contractRoot.
    const prepareStdout = await readFile(
      path.join(result.paths!.logsRoot, "prepare", "prepare.stdout.txt"),
      "utf8"
    );
    expect(prepareStdout).toContain(`prepared ${result.paths!.targetRoot}`);
    expect(statSync(path.join(result.paths!.targetRoot, "out", "report.json")).isFile()).toBe(true);
  });

  it("keeps all generated output inside runRoot and leaves the contract source unchanged", async () => {
    const port = await reservePort();
    const fixture = writeFixture({ port });
    const before = snapshotDirectory(fixture.contractRoot);
    const browser = createFakeBrowser({ page: createFakePage({ url: `http://127.0.0.1:${port}/` }) });

    const result = await runTutorial({
      scenarioPath: fixture.scenarioPath,
      targetContractPath: fixture.targetContractPath,
      context: context(fixture),
      outDir: fixture.outDir,
      launchBrowser: fakeLauncher(browser),
      generateRunId: () => RUN_ID
    });

    expect(result.status).toBe("passed");
    expect(snapshotDirectory(fixture.contractRoot)).toBe(before);
    for (const generated of [result.paths!.targetRoot, result.paths!.logsRoot]) {
      const relative = path.relative(result.paths!.runRoot, generated);
      expect(relative.startsWith("..")).toBe(false);
    }
  });

  // Required batch-boundary guard: Prompt 3 owns every visual artifact.
  it("produces no video, subtitle, markdown, manifest or screenshot artifacts", async () => {
    const port = await reservePort();
    const fixture = writeFixture({
      port,
      scenario: {
        steps: [
          {
            id: "open",
            narration: "Open the demo.",
            action: { type: "goto", path: "/" },
            highlight: { kind: "css", selector: "h1" },
            callout: { text: "This is the demo." },
            screenshot: { id: "demo-open", fullPage: true }
          }
        ]
      }
    });
    const page = createFakePage({ url: `http://127.0.0.1:${port}/` });
    const browser = createFakeBrowser({ page });

    const result = await runTutorial({
      scenarioPath: fixture.scenarioPath,
      targetContractPath: fixture.targetContractPath,
      context: context(fixture),
      outDir: fixture.outDir,
      launchBrowser: fakeLauncher(browser),
      generateRunId: () => RUN_ID
    });

    expect(result.status).toBe("passed");
    expect(result.steps[0]).toMatchObject({
      screenshotRequested: true,
      highlightRequested: true,
      calloutRequested: true
    });

    const produced: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir)) {
        const full = path.join(dir, entry);
        if (statSync(full).isDirectory()) walk(full);
        else produced.push(entry.toLowerCase());
      }
    };
    walk(result.paths!.runRoot);

    for (const forbidden of ["tutorial.webm", "tutorial.srt", "tutorial.vtt", "tutorial.md", "tutorial-manifest.json"]) {
      expect(produced).not.toContain(forbidden);
    }
    expect(produced.some((name) => name.endsWith(".png"))).toBe(false);
    expect(produced.some((name) => name.endsWith(".webm"))).toBe(false);
    expect(readdirSync(result.paths!.screenshotsRoot)).toEqual([]);
    expect(readdirSync(result.paths!.artifactsRoot)).toEqual([]);
    // The fake page throws if screenshot() is ever invoked.
    expect(page.calls.some((call) => call.method === "screenshot")).toBe(false);
  });
});

describe("runTutorial - contract and identity failures", () => {
  it("returns scenario-invalid without creating a run directory", async () => {
    const port = await reservePort();
    const fixture = writeFixture({ port });
    writeFileSync(fixture.scenarioPath, JSON.stringify({ schemaVersion: "9.9.9" }), "utf8");

    const result = await runTutorial({
      scenarioPath: fixture.scenarioPath,
      targetContractPath: fixture.targetContractPath,
      context: context(fixture),
      outDir: fixture.outDir,
      launchBrowser: async () => {
        throw new Error("browser must not launch");
      },
      generateRunId: () => RUN_ID
    });

    expect(result.status).toBe("scenario-invalid");
    expect(result.error).toContain("unsupported schemaVersion");
    expect(result.paths).toBeUndefined();
  });

  it("returns target-invalid for a bad target contract", async () => {
    const port = await reservePort();
    const fixture = writeFixture({ port });
    writeFileSync(
      fixture.targetContractPath,
      JSON.stringify({ schemaVersion: "1.0.0", id: "demo-target", prepare: { executable: "node" }, processes: [], applicationUrl: "http://example.com/" }),
      "utf8"
    );

    const result = await runTutorial({
      scenarioPath: fixture.scenarioPath,
      targetContractPath: fixture.targetContractPath,
      context: context(fixture),
      outDir: fixture.outDir,
      launchBrowser: async () => {
        throw new Error("browser must not launch");
      },
      generateRunId: () => RUN_ID
    });

    expect(result.status).toBe("target-invalid");
    expect(result.error).toContain("loopback hostname");
  });

  it("returns target-mismatch without preparing, starting processes or launching a browser", async () => {
    const port = await reservePort();
    const fixture = writeFixture({ port, scenario: { targetId: "other-demo" } });
    let browserLaunched = false;

    const result = await runTutorial({
      scenarioPath: fixture.scenarioPath,
      targetContractPath: fixture.targetContractPath,
      context: context(fixture),
      outDir: fixture.outDir,
      launchBrowser: async () => {
        browserLaunched = true;
        throw new Error("browser must not launch");
      },
      generateRunId: () => RUN_ID
    });

    expect(result.status).toBe("target-mismatch");
    expect(result.error).toContain('does not match target contract id "demo-target"');
    expect(browserLaunched).toBe(false);
    // No run directory, therefore no prepare and no managed process.
    expect(result.paths).toBeUndefined();
    expect(() => statSync(fixture.outDir)).toThrow();
  });
});

describe("runTutorial - prepare failures", () => {
  it("returns prepare-failed on a nonzero prepare exit and starts no process", async () => {
    const port = await reservePort();
    const fixture = writeFixture({ port });
    const contract = JSON.parse(await readFile(fixture.targetContractPath, "utf8")) as TutorialTargetContractV1;
    contract.prepare.env = { PREPARE_SHOULD_FAIL: "1" };
    writeFileSync(fixture.targetContractPath, JSON.stringify(contract), "utf8");
    let browserLaunched = false;

    const result = await runTutorial({
      scenarioPath: fixture.scenarioPath,
      targetContractPath: fixture.targetContractPath,
      context: context(fixture),
      outDir: fixture.outDir,
      launchBrowser: async () => {
        browserLaunched = true;
        throw new Error("browser must not launch");
      },
      generateRunId: () => RUN_ID
    });

    expect(result.status).toBe("prepare-failed");
    expect(result.error).toContain("prepare command exited with");
    expect(browserLaunched).toBe(false);
    expect(statSync(path.join(result.paths!.logsRoot, "prepare", "prepare.stderr.txt")).isFile()).toBe(true);
  });

  it("returns prepare-failed when targetRoot does not exist after a successful prepare", async () => {
    const port = await reservePort();
    const fixture = writeFixture({ port });
    const contract = JSON.parse(await readFile(fixture.targetContractPath, "utf8")) as TutorialTargetContractV1;
    contract.prepare.env = { PREPARE_SKIP_TARGET: "1" };
    writeFileSync(fixture.targetContractPath, JSON.stringify(contract), "utf8");

    const result = await runTutorial({
      scenarioPath: fixture.scenarioPath,
      targetContractPath: fixture.targetContractPath,
      context: context(fixture),
      outDir: fixture.outDir,
      launchBrowser: async () => {
        throw new Error("browser must not launch");
      },
      generateRunId: () => RUN_ID
    });

    expect(result.status).toBe("prepare-failed");
    expect(result.error).toContain("did not create the target directory");
  });
});

describe("runTutorial - process startup and readiness", () => {
  it("returns process-start-failed when a declared executable is unavailable", async () => {
    const port = await reservePort();
    const fixture = writeFixture({ port });
    const contract = JSON.parse(await readFile(fixture.targetContractPath, "utf8")) as TutorialTargetContractV1;
    contract.processes[0].executable = "definitely-not-a-real-command";
    writeFileSync(fixture.targetContractPath, JSON.stringify(contract), "utf8");
    let browserLaunched = false;

    const result = await runTutorial({
      scenarioPath: fixture.scenarioPath,
      targetContractPath: fixture.targetContractPath,
      context: context(fixture),
      outDir: fixture.outDir,
      launchBrowser: async () => {
        browserLaunched = true;
        throw new Error("browser must not launch");
      },
      generateRunId: () => RUN_ID
    });

    expect(result.status).toBe("process-start-failed");
    expect(result.error).toContain('Managed process "viewer" failed to start');
    expect(browserLaunched).toBe(false);
  });

  it("stops an already-started process when a later process fails to start", async () => {
    const port = await reservePort();
    const fixture = writeFixture({
      port,
      extraProcesses: [
        {
          id: "secondary",
          executable: "definitely-not-a-real-command",
          readiness: { kind: "http", url: `http://127.0.0.1:${port}/`, timeoutMs: 1000 }
        }
      ]
    });

    const result = await runTutorial({
      scenarioPath: fixture.scenarioPath,
      targetContractPath: fixture.targetContractPath,
      context: context(fixture),
      outDir: fixture.outDir,
      launchBrowser: async () => {
        throw new Error("browser must not launch");
      },
      generateRunId: () => RUN_ID
    });

    expect(result.status).toBe("process-start-failed");
    expect(result.error).toContain('"secondary"');
    expect(result.cleanupErrors).toEqual([]);
    // The first process was started and then stopped; its port is free again.
    await expect(fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(500) })).rejects.toThrow();
  });

  it("returns readiness-failed and cleans up on a readiness timeout", async () => {
    const port = await reservePort();
    const fixture = writeFixture({ port, processScript: NEVER_READY_SCRIPT });
    const contract = JSON.parse(await readFile(fixture.targetContractPath, "utf8")) as TutorialTargetContractV1;
    contract.processes[0].readiness = {
      kind: "http",
      url: `http://127.0.0.1:${port}/`,
      timeoutMs: 400,
      intervalMs: 50
    };
    writeFileSync(fixture.targetContractPath, JSON.stringify(contract), "utf8");
    let browserLaunched = false;

    const result = await runTutorial({
      scenarioPath: fixture.scenarioPath,
      targetContractPath: fixture.targetContractPath,
      context: context(fixture),
      outDir: fixture.outDir,
      launchBrowser: async () => {
        browserLaunched = true;
        throw new Error("browser must not launch");
      },
      generateRunId: () => RUN_ID
    });

    expect(result.status).toBe("readiness-failed");
    expect(result.error).toContain("did not become ready before the readiness timeout");
    expect(browserLaunched).toBe(false);
    expect(result.cleanupErrors).toEqual([]);
  });

  it("returns readiness-failed when the process exits before becoming ready", async () => {
    const port = await reservePort();
    const fixture = writeFixture({ port, processScript: EXIT_EARLY_SCRIPT });
    const contract = JSON.parse(await readFile(fixture.targetContractPath, "utf8")) as TutorialTargetContractV1;
    contract.processes[0].readiness = {
      kind: "http",
      url: `http://127.0.0.1:${port}/`,
      timeoutMs: 8000,
      intervalMs: 50
    };
    writeFileSync(fixture.targetContractPath, JSON.stringify(contract), "utf8");

    const result = await runTutorial({
      scenarioPath: fixture.scenarioPath,
      targetContractPath: fixture.targetContractPath,
      context: context(fixture),
      outDir: fixture.outDir,
      launchBrowser: async () => {
        throw new Error("browser must not launch");
      },
      generateRunId: () => RUN_ID
    });

    expect(result.status).toBe("readiness-failed");
    expect(result.error).toContain("exited before it became ready");
  });
});

describe("runTutorial - browser outcomes", () => {
  async function runWithLaunch(launch: () => Promise<BrowserLaunchResult>) {
    const port = await reservePort();
    const fixture = writeFixture({ port });
    return runTutorial({
      scenarioPath: fixture.scenarioPath,
      targetContractPath: fixture.targetContractPath,
      context: context(fixture),
      outDir: fixture.outDir,
      launchBrowser: launch,
      generateRunId: () => RUN_ID
    });
  }

  it("returns browser-unavailable when the Playwright module is missing", async () => {
    const result = await runWithLaunch(async () => ({
      status: "unavailable",
      reason: "playwright-module-unavailable",
      error: "Cannot find module 'playwright'"
    }));

    expect(result.status).toBe("browser-unavailable");
    expect(result.error).toContain("playwright-module-unavailable");
  });

  it("returns browser-unavailable when the Chromium binary is missing", async () => {
    const result = await runWithLaunch(async () => ({
      status: "unavailable",
      reason: "browser-runtime-unavailable",
      error: "Executable doesn't exist"
    }));

    expect(result.status).toBe("browser-unavailable");
    expect(result.error).toContain("browser-runtime-unavailable");
  });

  it("returns browser-failed on an unexpected launch failure", async () => {
    const result = await runWithLaunch(async () => ({
      status: "failed",
      error: "unexpected protocol error"
    }));

    expect(result.status).toBe("browser-failed");
    expect(result.error).toContain("unexpected protocol error");
  });
});

describe("runTutorial - step failures and cleanup", () => {
  it("returns step-failed when an action fails", async () => {
    const port = await reservePort();
    const fixture = writeFixture({
      port,
      scenario: {
        steps: [
          {
            id: "click-missing",
            narration: "Click a missing button.",
            action: { type: "click", locator: { kind: "css", selector: ".missing" } }
          },
          { id: "later", narration: "Never runs." }
        ]
      }
    });
    const page = createFakePage({
      url: `http://127.0.0.1:${port}/`,
      locators: { "css:.missing": { clickError: new Error("locator resolved to 0 elements") } }
    });

    const result = await runTutorial({
      scenarioPath: fixture.scenarioPath,
      targetContractPath: fixture.targetContractPath,
      context: context(fixture),
      outDir: fixture.outDir,
      launchBrowser: fakeLauncher(createFakeBrowser({ page })),
      generateRunId: () => RUN_ID
    });

    expect(result.status).toBe("step-failed");
    expect(result.steps.map((step) => step.status)).toEqual(["failed", "not-run"]);
    expect(result.error).toContain("click action failed");
  });

  it("returns step-failed when an assertion fails", async () => {
    const port = await reservePort();
    const fixture = writeFixture({
      port,
      scenario: {
        steps: [
          {
            id: "check",
            narration: "Check a missing file.",
            assertions: [{ type: "file-exists", path: "out/missing.json" }]
          }
        ]
      }
    });

    const result = await runTutorial({
      scenarioPath: fixture.scenarioPath,
      targetContractPath: fixture.targetContractPath,
      context: context(fixture),
      outDir: fixture.outDir,
      launchBrowser: fakeLauncher(createFakeBrowser({ page: createFakePage({ url: `http://127.0.0.1:${port}/` }) })),
      generateRunId: () => RUN_ID
    });

    expect(result.status).toBe("step-failed");
    expect(result.steps[0].assertions[0].status).toBe("failed");
  });

  it("closes browser resources before stopping managed processes", async () => {
    const port = await reservePort();
    const fixture = writeFixture({ port });
    const browser = createFakeBrowser({ page: createFakePage({ url: `http://127.0.0.1:${port}/` }) });

    const result = await runTutorial({
      scenarioPath: fixture.scenarioPath,
      targetContractPath: fixture.targetContractPath,
      context: context(fixture),
      outDir: fixture.outDir,
      launchBrowser: fakeLauncher(browser),
      generateRunId: () => RUN_ID
    });

    expect(result.status).toBe("passed");
    expect(browser.events).toEqual(["context.create", "context.close", "browser.close"]);
    // The managed process is gone once the run returns.
    await expect(fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(500) })).rejects.toThrow();
  });

  it("stops managed processes in reverse startup order", async () => {
    const firstPort = await reservePort();
    const secondPort = await reservePort();
    const fixture = writeFixture({
      port: firstPort,
      extraProcesses: [
        {
          id: "secondary",
          executable: process.execPath,
          args: ["server.js"],
          cwd: "contract-root",
          env: { TUTORIAL_TEST_PORT: String(secondPort) },
          readiness: { kind: "http", url: `http://127.0.0.1:${secondPort}/`, timeoutMs: 10_000, intervalMs: 50 }
        }
      ]
    });
    const browser = createFakeBrowser({ page: createFakePage({ url: `http://127.0.0.1:${firstPort}/` }) });

    const result = await runTutorial({
      scenarioPath: fixture.scenarioPath,
      targetContractPath: fixture.targetContractPath,
      context: context(fixture),
      outDir: fixture.outDir,
      launchBrowser: fakeLauncher(browser),
      generateRunId: () => RUN_ID
    });

    expect(result.status).toBe("passed");
    // Both log files exist and both listeners are gone after the run.
    const processLogs = readdirSync(path.join(result.paths!.logsRoot, "processes")).sort();
    expect(processLogs).toContain("viewer.stdout.txt");
    expect(processLogs).toContain("secondary.stdout.txt");
    for (const port of [firstPort, secondPort]) {
      await expect(fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(500) })).rejects.toThrow();
    }
  });

  it("records cleanup errors without replacing an existing primary failure", async () => {
    const port = await reservePort();
    const fixture = writeFixture({
      port,
      scenario: {
        steps: [
          {
            id: "check",
            narration: "Check a missing file.",
            assertions: [{ type: "file-exists", path: "out/missing.json" }]
          }
        ]
      }
    });
    const browser = createFakeBrowser({
      page: createFakePage({ url: `http://127.0.0.1:${port}/` }),
      browserCloseError: new Error("browser refused to close")
    });

    const result = await runTutorial({
      scenarioPath: fixture.scenarioPath,
      targetContractPath: fixture.targetContractPath,
      context: context(fixture),
      outDir: fixture.outDir,
      launchBrowser: fakeLauncher(browser),
      generateRunId: () => RUN_ID
    });

    expect(result.status).toBe("step-failed");
    expect(result.cleanupErrors.join("\n")).toContain("browser refused to close");
    expect(result.error).not.toContain("browser refused to close");
  });

  it("returns cleanup-failed when an otherwise-passing run cannot clean up", async () => {
    const port = await reservePort();
    const fixture = writeFixture({ port });
    const browser = createFakeBrowser({
      page: createFakePage({ url: `http://127.0.0.1:${port}/` }),
      contextCloseError: new Error("context refused to close")
    });

    const result = await runTutorial({
      scenarioPath: fixture.scenarioPath,
      targetContractPath: fixture.targetContractPath,
      context: context(fixture),
      outDir: fixture.outDir,
      launchBrowser: fakeLauncher(browser),
      generateRunId: () => RUN_ID
    });

    expect(result.status).toBe("cleanup-failed");
    expect(result.steps[0].status).toBe("passed");
    expect(result.cleanupErrors.join("\n")).toContain("context refused to close");
  });
});

describe("runTutorial - output location", () => {
  it("uses the workspace tutorial layout when no outDir is supplied", async () => {
    const port = await reservePort();
    const fixture = writeFixture({ port });
    const browser = createFakeBrowser({ page: createFakePage({ url: `http://127.0.0.1:${port}/` }) });

    const result = await runTutorial({
      scenarioPath: fixture.scenarioPath,
      targetContractPath: fixture.targetContractPath,
      context: context(fixture),
      launchBrowser: fakeLauncher(browser),
      generateRunId: () => RUN_ID
    });

    expect(result.status).toBe("passed");
    expect(result.paths!.runRoot).toBe(
      path.join(fixture.workspaceRoot, "tutorials", "demo-tutorial", RUN_ID)
    );
  });

  it("resolves a relative outDir against invocationCwd", async () => {
    const port = await reservePort();
    const fixture = writeFixture({ port });
    mkdirSync(fixture.invocationCwd, { recursive: true });
    const browser = createFakeBrowser({ page: createFakePage({ url: `http://127.0.0.1:${port}/` }) });

    const result = await runTutorial({
      scenarioPath: fixture.scenarioPath,
      targetContractPath: fixture.targetContractPath,
      context: context(fixture),
      outDir: "relative-run",
      launchBrowser: fakeLauncher(browser),
      generateRunId: () => RUN_ID
    });

    expect(result.status).toBe("passed");
    expect(result.paths!.runRoot).toBe(path.join(fixture.invocationCwd, "relative-run"));
  });
});
