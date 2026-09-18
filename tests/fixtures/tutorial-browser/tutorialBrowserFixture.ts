import { copyFileSync, mkdirSync, writeFileSync } from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Generic lab-owned tutorial browser fixture.
 *
 * Self-contained and dependency-free: a static HTML app, a Node http server and
 * a prepare script, all under this directory. It belongs to my-dev-kit-lab's own
 * tests and never requires a sibling product checkout.
 *
 * The scenario is committed and port-independent (it only uses root-relative
 * paths). The target contract is generated per run because it must name a
 * concrete loopback port.
 */

export const TUTORIAL_FIXTURE_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "examples",
  "tutorial-browser"
);
export const TUTORIAL_FIXTURE_SCENARIO_PATH = path.join(TUTORIAL_FIXTURE_DIR, "scenario.json");
export const TUTORIAL_FIXTURE_TARGET_ID = "lab-browser-fixture";

/** Reserves a free loopback port by binding and immediately releasing it. */
export async function reserveLoopbackPort(): Promise<number> {
  const server = http.createServer(() => undefined);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const port = (server.address() as { port: number }).port;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

export type MaterializedFixtureContract = {
  contractRoot: string;
  scenarioPath: string;
  targetContractPath: string;
  applicationUrl: string;
  port: number;
};

/**
 * Writes a target contract (and a copy of the scenario) into `contractRoot`.
 *
 * `prepare.mjs` and `server.mjs` are referenced by absolute path into this fixture
 * directory, and `prepare.mjs` copies the app into the run-owned target root, so
 * the served application is always the disposable copy rather than this
 * directory.
 */
export function materializeTutorialFixtureContract(options: {
  contractRoot: string;
  port: number;
  scenarioOverrides?: Record<string, unknown>;
}): MaterializedFixtureContract {
  mkdirSync(options.contractRoot, { recursive: true });
  const applicationUrl = `http://127.0.0.1:${options.port}/`;

  const scenarioPath = path.join(options.contractRoot, "scenario.json");
  if (options.scenarioOverrides) {
    writeFileSync(scenarioPath, JSON.stringify(options.scenarioOverrides, null, 2), "utf8");
  } else {
    copyFileSync(TUTORIAL_FIXTURE_SCENARIO_PATH, scenarioPath);
  }

  const targetContract = {
    schemaVersion: "1.0.0",
    id: TUTORIAL_FIXTURE_TARGET_ID,
    prepare: {
      executable: process.execPath,
      args: [path.join(TUTORIAL_FIXTURE_DIR, "prepare.mjs"), "{{targetRoot}}"]
    },
    processes: [
      {
        id: "fixture-server",
        executable: process.execPath,
        args: ["{{targetRoot}}/app/server.mjs"],
        cwd: "target-root",
        env: { TUTORIAL_FIXTURE_PORT: String(options.port) },
        readiness: {
          kind: "http",
          url: applicationUrl,
          timeoutMs: 15000,
          intervalMs: 100
        }
      }
    ],
    applicationUrl
  };

  const targetContractPath = path.join(options.contractRoot, "target-contract.json");
  writeFileSync(targetContractPath, JSON.stringify(targetContract, null, 2), "utf8");

  return {
    contractRoot: options.contractRoot,
    scenarioPath,
    targetContractPath,
    applicationUrl,
    port: options.port
  };
}
