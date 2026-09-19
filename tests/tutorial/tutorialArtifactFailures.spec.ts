import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, statSync } from "node:fs";
import { rm } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { BrowserLaunchResult } from "../../src/browser/index.js";
import { createLabExecutionContext } from "../../src/runtime/labExecutionContext.js";
import { runTutorial } from "../../src/tutorial/runTutorial.js";
import type { TutorialManifestV1 } from "../../src/tutorial/tutorialManifest.js";
import type { TutorialScenarioV1 } from "../../src/tutorial/types.js";
import {
  createFakeBrowser,
  createFakePage,
  createFakeVideo,
  type FakeBrowser,
  type FakePage
} from "./tutorialTestHelpers.js";

/**
 * Artifact-failure semantics.
 *
 * Uses a real prepare command, a real managed process and a real loopback server
 * so only the browser is faked; each case then breaks exactly one artifact.
 */

const tempDirs: string[] = [];
afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

const PREPARE_SCRIPT = `
import fs from "node:fs";
import path from "node:path";
const targetRoot = process.argv[2];
fs.mkdirSync(path.join(targetRoot, "out"), { recursive: true });
fs.writeFileSync(path.join(targetRoot, "out", "report.json"), JSON.stringify({ ok: true }), "utf8");
console.log("prepared");
`;

const SERVER_SCRIPT = `
import http from "node:http";
const port = Number(process.env.TUTORIAL_TEST_PORT || 0);
http.createServer((req, res) => {
  res.writeHead(200, { "content-type": "text/html" });
  res.end("<html><body><h1>demo</h1></body></html>");
}).listen(port, "127.0.0.1", () => console.log("listening"));
`;

async function reservePort(): Promise<number> {
  const server = http.createServer(() => undefined);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const port = (server.address() as { port: number }).port;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

type Fixture = {
  scenarioPath: string;
  targetContractPath: string;
  outDir: string;
  invocationCwd: string;
  workspaceRoot: string;
  port: number;
};

async function writeFixture(steps?: TutorialScenarioV1["steps"]): Promise<Fixture> {
  const port = await reservePort();
  const contractRoot = makeTempDir("artifact-fail-contract-");
  const invocationCwd = makeTempDir("artifact-fail-cwd-");
  const workspaceRoot = makeTempDir("artifact-fail-ws-");
  const outDir = path.join(makeTempDir("artifact-fail-out-"), "run");

  writeFileSync(path.join(contractRoot, "prepare.mjs"), PREPARE_SCRIPT, "utf8");
  writeFileSync(path.join(contractRoot, "server.mjs"), SERVER_SCRIPT, "utf8");

  const scenario: TutorialScenarioV1 = {
    schemaVersion: "1.0.0",
    id: "demo-tutorial",
    title: "Demo tutorial",
    targetId: "demo-target",
    browser: { viewport: { width: 800, height: 600 } },
    steps: steps ?? [
      { id: "open", narration: "Open the demo.", action: { type: "goto", path: "/" } },
      { id: "check", narration: "Check the path.", assertions: [{ type: "url-path-equals", expected: "/" }] }
    ]
  };

  const targetContract = {
    schemaVersion: "1.0.0",
    id: "demo-target",
    prepare: { executable: process.execPath, args: ["prepare.mjs", "{{targetRoot}}"] },
    processes: [
      {
        id: "viewer",
        executable: process.execPath,
        args: ["server.mjs"],
        cwd: "contract-root",
        env: { TUTORIAL_TEST_PORT: String(port) },
        readiness: { kind: "http", url: `http://127.0.0.1:${port}/`, timeoutMs: 10000, intervalMs: 50 }
      }
    ],
    applicationUrl: `http://127.0.0.1:${port}/`
  };

  const scenarioPath = path.join(contractRoot, "scenario.json");
  const targetContractPath = path.join(contractRoot, "target.json");
  writeFileSync(scenarioPath, JSON.stringify(scenario, null, 2), "utf8");
  writeFileSync(targetContractPath, JSON.stringify(targetContract, null, 2), "utf8");

  return { scenarioPath, targetContractPath, outDir, invocationCwd, workspaceRoot, port };
}

function run(fixture: Fixture, browser: FakeBrowser) {
  return runTutorial({
    scenarioPath: fixture.scenarioPath,
    targetContractPath: fixture.targetContractPath,
    context: createLabExecutionContext({
      invocationCwd: fixture.invocationCwd,
      workspaceRoot: fixture.workspaceRoot
    }),
    outDir: fixture.outDir,
    generateRunId: () => "artifact-run",
    sleep: async () => {},
    launchBrowser: async (): Promise<BrowserLaunchResult> => ({ status: "launched", browser })
  });
}

function pageFor(fixture: Fixture, options: Parameters<typeof createFakePage>[0] = {}): FakePage {
  return createFakePage({ url: `http://127.0.0.1:${fixture.port}/`, ...options });
}

describe("artifact outcomes on a failed tutorial", () => {
  it("still finalizes video and writes subtitles for the executed steps only", async () => {
    const fixture = await writeFixture([
      { id: "open", narration: "Open the demo.", action: { type: "goto", path: "/" } },
      { id: "bad", narration: "This step fails.", assertions: [{ type: "url-path-equals", expected: "/nope" }] },
      { id: "never", narration: "Never runs." }
    ]);
    const result = await run(fixture, createFakeBrowser({ page: pageFor(fixture) }));

    expect(result.status).toBe("step-failed");
    expect(result.steps.map((step) => step.status)).toEqual(["passed", "failed", "not-run"]);

    // A failed tutorial still yields a usable recording.
    expect(result.artifacts.video?.status).toBe("written");
    expect(statSync(path.join(result.paths!.artifactsRoot, "tutorial.webm")).size).toBeGreaterThan(0);

    const srt = readFileSync(path.join(result.paths!.artifactsRoot, "tutorial.srt"), "utf8");
    expect(srt).toContain("Open the demo.");
    expect(srt).toContain("This step fails.");
    expect(srt).not.toContain("Never runs.");

    const markdown = readFileSync(path.join(result.paths!.artifactsRoot, "tutorial.md"), "utf8");
    expect(markdown).toContain("**This step failed during execution.**");
    expect(markdown).not.toContain("Never runs.");
  });

  it("writes a manifest that reports the real failure while distinguishing artifact status", async () => {
    const fixture = await writeFixture([
      { id: "bad", narration: "Fails.", assertions: [{ type: "url-path-equals", expected: "/nope" }] }
    ]);
    const result = await run(fixture, createFakeBrowser({ page: pageFor(fixture) }));

    const manifest = JSON.parse(
      readFileSync(path.join(result.paths!.artifactsRoot, "tutorial-manifest.json"), "utf8")
    ) as TutorialManifestV1;

    // Run failed, video succeeded: two independent facts.
    expect(manifest.run.status).toBe("step-failed");
    expect(manifest.artifacts.find((record) => record.kind === "video")?.status).toBe("written");
    expect(manifest.steps[0].status).toBe("failed");
  });

  it("preserves step-failed as the primary status when video finalization also fails", async () => {
    const fixture = await writeFixture([
      { id: "bad", narration: "Fails.", assertions: [{ type: "url-path-equals", expected: "/nope" }] }
    ]);
    const page = pageFor(fixture, {
      video: createFakeVideo({ saveAsError: new Error("transport closed") })
    });
    const result = await run(fixture, createFakeBrowser({ page }));

    expect(result.status).toBe("step-failed");
    expect(result.error).toContain("assertions failed");
    expect(result.error).not.toContain("transport closed");
    expect(result.artifacts.video?.status).toBe("failed");
    // The artifact problem is recorded, not hidden.
    expect(result.warnings.join("\n")).toContain("transport closed");
  });
});

describe("artifact failures on an otherwise passing run", () => {
  it("returns video-finalization-failed when the canonical WebM cannot be saved", async () => {
    const fixture = await writeFixture();
    const page = pageFor(fixture, { video: createFakeVideo({ saveAsError: new Error("save refused") }) });
    const result = await run(fixture, createFakeBrowser({ page }));

    expect(result.steps.every((step) => step.status === "passed")).toBe(true);
    expect(result.status).toBe("video-finalization-failed");
    expect(result.error).toContain("save refused");
    expect(result.artifacts.video?.status).toBe("failed");
    // Non-video artifacts were still produced.
    expect(result.artifacts.srt?.status).toBe("written");
    expect(result.artifacts.manifest?.status).toBe("written");
  });

  it("returns video-finalization-failed when the saved WebM is empty", async () => {
    const fixture = await writeFixture();
    const page = pageFor(fixture, {
      video: createFakeVideo({ onSave: (target) => writeFileSync(target, Buffer.alloc(0)) })
    });
    const result = await run(fixture, createFakeBrowser({ page }));

    expect(result.status).toBe("video-finalization-failed");
    expect(result.artifacts.video?.error).toContain("empty");
  });

  it("returns video-finalization-failed when recording started but produced no video", async () => {
    const fixture = await writeFixture();
    const result = await run(fixture, createFakeBrowser({ page: pageFor(fixture, { video: null }) }));

    expect(result.status).toBe("video-finalization-failed");
    expect(result.artifacts.video?.status).toBe("skipped");
  });

  it("returns artifact-failed when a requested screenshot fails", async () => {
    const fixture = await writeFixture([
      { id: "open", narration: "Open.", action: { type: "goto", path: "/" }, screenshot: { id: "shot" } }
    ]);
    const page = pageFor(fixture, { screenshotError: new Error("capture refused") });
    const result = await run(fixture, createFakeBrowser({ page }));

    expect(result.steps.every((step) => step.status === "passed")).toBe(true);
    expect(result.status).toBe("artifact-failed");
    expect(result.error).toContain("capture refused");
    expect(result.artifacts.screenshots[0].status).toBe("failed");
    // Video was fine, so the more specific video status does not apply.
    expect(result.artifacts.video?.status).toBe("written");
  });

  it("returns artifact-failed when the manifest cannot be written", async () => {
    const fixture = await writeFixture();
    // Occupy the manifest path with a directory so the write cannot succeed.
    mkdirSync(path.join(fixture.outDir, "artifacts"), { recursive: true });
    mkdirSync(path.join(fixture.outDir, "artifacts", "tutorial-manifest.json"), { recursive: true });

    const result = await run(fixture, createFakeBrowser({ page: pageFor(fixture) }));

    expect(result.status).toBe("artifact-failed");
    expect(result.artifacts.manifest?.status).toBe("failed");
    expect(result.error).toContain("tutorial-manifest.json");
  });

  it("prefers video-finalization-failed over artifact-failed when both occur", async () => {
    const fixture = await writeFixture([
      { id: "open", narration: "Open.", action: { type: "goto", path: "/" }, screenshot: { id: "shot" } }
    ]);
    const page = pageFor(fixture, {
      screenshotError: new Error("capture refused"),
      video: createFakeVideo({ saveAsError: new Error("save refused") })
    });
    const result = await run(fixture, createFakeBrowser({ page }));

    expect(result.status).toBe("video-finalization-failed");
    expect(result.artifacts.screenshots[0].status).toBe("failed");
    expect(result.artifacts.video?.status).toBe("failed");
  });

  it("records video as skipped, not failed, when the browser never started recording", async () => {
    const fixture = await writeFixture();
    const result = await runTutorial({
      scenarioPath: fixture.scenarioPath,
      targetContractPath: fixture.targetContractPath,
      context: createLabExecutionContext({
        invocationCwd: fixture.invocationCwd,
        workspaceRoot: fixture.workspaceRoot
      }),
      outDir: fixture.outDir,
      generateRunId: () => "artifact-run",
      sleep: async () => {},
      launchBrowser: async () => ({
        status: "unavailable",
        reason: "browser-runtime-unavailable",
        error: "Executable doesn't exist"
      })
    });

    expect(result.status).toBe("browser-unavailable");
    expect(result.artifacts.video?.status).toBe("skipped");
    expect(result.artifacts.video?.error).toContain("never started");
    // The earlier failure is not reclassified as a video problem.
    expect(result.error).toContain("browser-runtime-unavailable");
  });

  it("still writes a manifest reporting an early failure once run paths exist", async () => {
    const fixture = await writeFixture();
    const result = await runTutorial({
      scenarioPath: fixture.scenarioPath,
      targetContractPath: fixture.targetContractPath,
      context: createLabExecutionContext({
        invocationCwd: fixture.invocationCwd,
        workspaceRoot: fixture.workspaceRoot
      }),
      outDir: fixture.outDir,
      generateRunId: () => "artifact-run",
      sleep: async () => {},
      launchBrowser: async () => ({ status: "failed", error: "protocol error" })
    });

    expect(result.status).toBe("browser-failed");
    expect(result.artifacts.manifest?.status).toBe("written");

    const manifest = JSON.parse(
      readFileSync(path.join(result.paths!.artifactsRoot, "tutorial-manifest.json"), "utf8")
    ) as TutorialManifestV1;
    expect(manifest.run.status).toBe("browser-failed");
    expect(manifest.steps).toEqual([]);
    // No artifact is claimed to exist.
    for (const record of manifest.artifacts) {
      expect(record.status).toBe("skipped");
    }
  });
});
