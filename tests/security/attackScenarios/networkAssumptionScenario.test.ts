import fs, { mkdirSync, mkdtempSync, readFileSync, writeFileSync, renameSync, symlinkSync, linkSync } from "node:fs";
import { rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import http from "node:http";
import { startManagedProcess } from "../../../src/runtime/managedProcess.js";
import { NETWORK_ASSUMPTION_SCENARIO } from "../../../src/securityValidation/attackScenarios/scenarios/networkAssumptionScenario.js";
import { DEFAULT_SECURITY_CONFIG } from "../../../src/securityValidation/config.js";
import type { SecurityValidationTarget } from "../../../src/securityValidation/validate/resolveTarget.js";
import type { AttackScenarioContext } from "../../../src/securityValidation/attackScenarios/attackScenario.js";

function fakeTarget(targetRoot: string): SecurityValidationTarget {
  return {
    targetRoot,
    toolRoot: targetRoot,
    packageName: "fixture",
    packageVersion: "1.0.0",
    hasPackageJson: true,
    hasSecurityTestScript: false,
    hasLockfile: false,
    branch: "main",
    commit: "abc",
    hasGit: false,
    isSelf: true,
  };
}

function makeCtx(targetRoot: string): AttackScenarioContext {
  return {
    toolRoot: targetRoot,
    target: fakeTarget(targetRoot),
    profile: "node-cli-package",
    config: DEFAULT_SECURITY_CONFIG,
  };
}

const cleanupDirs: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(cleanupDirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

function makeFixtureDir(prefix: string): string {
  const root = mkdtempSync(path.join(fs.realpathSync.native(os.tmpdir()), prefix));
  mkdirSync(path.join(root, "src"), { recursive: true });
  cleanupDirs.push(root);
  return root;
}

describe("NETWORK_ASSUMPTION_SCENARIO", () => {
  it.each(["build", "dist", "node_modules", "coverage", "Build"])("scans an ordinary source file named %s", async name => {
    const root = makeFixtureDir("net-file-type-");
    writeFileSync(path.join(root, "src", name), "export const request = url => fetch(url);\n");
    const outcome = await NETWORK_ASSUMPTION_SCENARIO.run(makeCtx(root));
    expect(outcome.status).toBe("failed");
    expect(outcome.severity).toBe("major");
    expect(outcome.evidence.some(e => e.filePath === `src/${name}`)).toBe(true);
  });

  it.each(["build", "dist", "node_modules", "coverage"])("still excludes the generated %s directory", async name => {
    const root = makeFixtureDir("net-directory-type-");
    mkdirSync(path.join(root, "src", name));
    writeFileSync(path.join(root, "src", name, "generated.ts"), "fetch(url);\n");
    writeFileSync(path.join(root, "src", "ordinary.ts"), "export const local = true;\n");
    const outcome = await NETWORK_ASSUMPTION_SCENARIO.run(makeCtx(root));
    expect(outcome.status).toBe("passed");
    expect(outcome.evidence.some(e => e.filePath?.startsWith(`src/${name}/`))).toBe(false);
  });

  const reviewedFiles = [
    "src/runtime/managedProcess.ts", "src/tutorial/tutorialAssertions.ts",
    "src/tutorial/runTutorial.ts", "src/tutorial/tutorialSession.ts", "src/tutorial/targetContractValidation.ts",
    "src/tutorial/loadTutorialContracts.ts", "src/tutorial/validationPrimitives.ts"
  ];
  function reviewedFixture(): string {
    const root = makeFixtureDir("net-reviewed-");
    for (const file of reviewedFiles) {
      mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
      writeFileSync(path.join(root, file), readFileSync(path.resolve(file)));
    }
    return root;
  }

  function linkFixture(target: string, link: string, directory = false): void {
    try {
      symlinkSync(target, link, directory ? (process.platform === "win32" ? "junction" : "dir") : "file");
      console.info(`LINK_CONTROL: real ${directory ? "directory" : "file"} link`);
    } catch (error) {
      if (!["EPERM", "EACCES"].includes((error as NodeJS.ErrnoException).code ?? "")) throw error;
      if (directory) mkdirSync(link); else writeFileSync(link, "");
      const inspect = fs.lstatSync;
      vi.spyOn(fs, "lstatSync").mockImplementation(((file: fs.PathLike, ...args: any[]) => {
        const stat = (inspect as any)(file, ...args);
        return path.resolve(String(file)) === link
          ? Object.assign(Object.create(stat), { isSymbolicLink: () => true }) : stat;
      }) as typeof fs.lstatSync);
      console.info("LINK_CONTROL: injected lstat refusal; host denied real link creation");
    }
  }

  it.each(process.platform === "win32" ? ["runtime", "src"] : ["runtime"])("never trusts different-case %s spelling", async segment => {
    const root = reviewedFixture();
    const from = path.join(root, segment === "src" ? "src" : "src/runtime");
    const to = path.join(root, segment === "src" ? "Src" : "src/Runtime");
    // Two renames also work on case-insensitive Windows filesystems.
    renameSync(from, from + "-rename");
    renameSync(from + "-rename", to);
    const outcome = await NETWORK_ASSUMPTION_SCENARIO.run(makeCtx(root));
    expect(outcome.status).toBe("failed");
    expect(outcome.severity).toBe("major");
    const observed = segment === "src" ? "Src/runtime/managedProcess.ts" : "src/Runtime/managedProcess.ts";
    expect(outcome.evidence.some(e => e.filePath === observed)).toBe(true);
    expect(outcome.evidence.filter(e => e.source === "known-intentional local HTTP use").map(e => e.filePath))
      .not.toContain("src/runtime/managedProcess.ts");
  });

  it("refuses a link named like an excluded directory without reading its target", async () => {
    const root = makeFixtureDir("net-exclusion-alias-");
    const outside = makeFixtureDir("net-exclusion-owned-");
    const target = path.join(outside, "target.ts"), link = path.join(root, "src/build");
    writeFileSync(target, "fetch(url);\n");
    linkFixture(target, link);
    const read = fs.readFileSync;
    const reads = vi.spyOn(fs, "readFileSync").mockImplementation(((file: fs.PathOrFileDescriptor, ...args: any[]) => {
      if (file === target || file === link) throw new Error("linked target must not be read");
      return (read as any)(file, ...args);
    }) as typeof fs.readFileSync);
    const outcome = await NETWORK_ASSUMPTION_SCENARIO.run(makeCtx(root));
    expect(reads.mock.calls.some(([file]) => file === target || file === link)).toBe(false);
    expect(outcome.status).toBe("failed");
    expect(outcome.severity).toBe("major");
    expect(outcome.evidence.some(e => e.source === "source provenance refusal" && e.filePath === "src/build")).toBe(true);
  });

  it.each(["LF", "CRLF"])("recognizes exactly unchanged reviewed %s content and callers", async mode => {
    const root = reviewedFixture();
    for (const file of reviewedFiles) {
      const text = readFileSync(path.join(root, file), "utf8").replace(/\r\n/g, "\n");
      writeFileSync(path.join(root, file), mode === "CRLF" ? text.replace(/\n/g, "\r\n") : text);
    }
    const outcome = await NETWORK_ASSUMPTION_SCENARIO.run(makeCtx(root));
    expect(outcome.status).toBe("passed");
    expect(outcome.evidence.filter(e => e.source === "known-intentional local HTTP use").map(e => e.filePath))
      .toEqual(reviewedFiles.slice(0, 2));
  });

  it.each(reviewedFiles)("refuses a direct in-root link at %s before reading its bytes", async file => {
    const root = reviewedFixture();
    const link = path.join(root, file);
    const physical = path.join(root, "underlying.ts");
    renameSync(link, physical);
    linkFixture(physical, link);
    const read = fs.readFileSync;
    const reads = vi.spyOn(fs, "readFileSync").mockImplementation(((candidate: fs.PathOrFileDescriptor, ...args: any[]) => {
      if (candidate === link || candidate === physical) throw new Error("linked content must never be read");
      return (read as any)(candidate, ...args);
    }) as typeof fs.readFileSync);
    const outcome = await NETWORK_ASSUMPTION_SCENARIO.run(makeCtx(root));
    expect(reads.mock.calls.some(([candidate]) => candidate === link || candidate === physical)).toBe(false);
    expect(outcome.status).toBe("failed");
    expect(outcome.severity).toBe("major");
    expect(outcome.evidence.some(e => e.source === "source provenance refusal" && e.filePath === file)).toBe(true);
    expect(outcome.evidence.filter(e => e.source === "known-intentional local HTTP use").map(e => e.filePath))
      .not.toContain(file === reviewedFiles[0] ? reviewedFiles[0] : reviewedFiles[1]);
  });

  it.each(["outside-file", "outside-directory", "dangling", "unknown", "inside-directory"])("refuses %s alias without target reads", async kind => {
    const root = reviewedFixture();
    const outside = makeFixtureDir("net-owned-outside-");
    const directory = kind.endsWith("directory");
    const file = kind === "unknown" ? "src/client.ts" : reviewedFiles[0]!;
    const link = directory ? path.join(root, "src/runtime") : path.join(root, file);
    const physical = path.join(kind === "inside-directory" ? root : outside, directory ? "runtime-physical" : "underlying.ts");
    if (kind === "unknown") writeFileSync(physical, "export const request = (url: string) => fetch(url);\n");
    else renameSync(link, physical);
    linkFixture(kind === "dangling" ? path.join(outside, "missing.ts") : physical, link, directory);
    const forbidden = (candidate: unknown): boolean => typeof candidate === "string" &&
      (candidate === link || candidate.startsWith(link + path.sep) || candidate.startsWith(outside + path.sep) ||
        candidate === physical || candidate.startsWith(physical + path.sep));
    const read = fs.readFileSync;
    const reads = vi.spyOn(fs, "readFileSync").mockImplementation(((candidate: fs.PathOrFileDescriptor, ...args: any[]) => {
      if (forbidden(candidate)) throw new Error("alias target content must never be read");
      return (read as any)(candidate, ...args);
    }) as typeof fs.readFileSync);
    const outcome = await NETWORK_ASSUMPTION_SCENARIO.run(makeCtx(root));
    expect(reads.mock.calls.some(([candidate]) => forbidden(candidate))).toBe(false);
    expect(outcome.status).toBe("failed");
    expect(outcome.severity).toBe("major");
    expect(outcome.evidence.some(e => e.source === "source provenance refusal")).toBe(true);
    if (kind !== "unknown") expect(outcome.evidence.filter(e => e.source === "known-intentional local HTTP use").map(e => e.filePath))
      .not.toContain(reviewedFiles[0]);
  });

  it("refuses a linked scan root instead of treating zero files as clean", async () => {
    const physical = reviewedFixture();
    const enclosure = makeFixtureDir("net-root-alias-");
    const link = path.join(enclosure, "scan");
    linkFixture(physical, link, true);
    const outcome = await NETWORK_ASSUMPTION_SCENARIO.run(makeCtx(link));
    expect(outcome.status).toBe("failed");
    expect(outcome.severity).toBe("major");
    expect(outcome.evidence.filter(e => e.source === "known-intentional local HTTP use")).toHaveLength(0);
  });

  it.each(["unreadable", "binary", "oversized", "physical-alias", "directory", "hardlink"])("%s reviewed source fails closed", async kind => {
    const root = reviewedFixture();
    const file = path.join(root, reviewedFiles[0]!);
    if (kind === "directory" || kind === "hardlink") {
      const physical = path.join(root, "underlying.ts");
      renameSync(file, physical);
      if (kind === "directory") mkdirSync(file); else linkSync(physical, file);
    } else if (kind === "binary") writeFileSync(file, Buffer.from([0]));
    else if (kind === "oversized") writeFileSync(file, "x".repeat(1_000_001));
    else if (kind === "unreadable") {
      const read = fs.readFileSync;
      vi.spyOn(fs, "readFileSync").mockImplementation(((candidate: fs.PathOrFileDescriptor, ...args: any[]) => {
        if (candidate === file) throw Object.assign(new Error("denied"), { code: "EACCES" });
        return (read as any)(candidate, ...args);
      }) as typeof fs.readFileSync);
    } else {
      const realpath = fs.realpathSync.native;
      vi.spyOn(fs.realpathSync, "native").mockImplementation(((candidate: fs.PathLike, ...args: any[]) =>
        candidate === file ? path.join(root, "different.ts") : (realpath as any)(candidate, ...args)) as typeof realpath);
    }
    const outcome = await NETWORK_ASSUMPTION_SCENARIO.run(makeCtx(root));
    expect(outcome.status).toBe("failed");
    expect(outcome.severity).toBe("major");
    expect(outcome.evidence.some(e => e.source === "source provenance refusal" && e.filePath === reviewedFiles[0])).toBe(true);
  });

  it.each(reviewedFiles.slice(0, 2))("changed loopback host and bare CR in %s remain unreviewed", async file => {
    for (const mutation of ["host", "bare-cr"]) {
      const root = reviewedFixture();
      const text = readFileSync(path.join(root, file), "utf8");
      const changed = mutation === "host" ? text.replace("127.0.0.1", "example.invalid") : text.replace(/\r?\n/, "\r");
      expect(changed).not.toBe(text);
      writeFileSync(path.join(root, file), changed);
      const outcome = await NETWORK_ASSUMPTION_SCENARIO.run(makeCtx(root));
      expect(outcome.status).toBe("failed");
      expect(outcome.severity).toBe("major");
    }
  });

  it("separately reports both exact reviewed sites and makes zero network calls", async () => {
    const root = reviewedFixture();
    const request = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("scanner must not request"));
    const outcome = await NETWORK_ASSUMPTION_SCENARIO.run(makeCtx(root));
    expect(outcome.status).toBe("passed");
    const sites = outcome.evidence.filter(e => e.source === "known-intentional local HTTP use");
    expect(sites.map(e => e.filePath)).toEqual(reviewedFiles.slice(0, 2));
    expect(sites.every(e => e.expectedBehavior?.includes("do not prove full runtime network isolation"))).toBe(true);
    expect(outcome.evidence.some(e => e.observedBehavior?.includes("0 unexpected match(es), 2 known-intentional"))).toBe(true);
    expect(request).not.toHaveBeenCalled();
  });

  for (const file of reviewedFiles.slice(0, 2)) {
    it.each(["extra-fetch", "changed-guard", "changed-bytes"])(`${file} %s fails closed as major`, async mutation => {
      const root = reviewedFixture();
      const original = readFileSync(path.join(root, file), "utf8");
      const changed = mutation === "extra-fetch" ? original + '\nfetch("http://example.invalid/");\n'
        : mutation === "changed-guard" ? original.replace('redirect: "manual"', 'redirect: "follow"')
        : original + "\n// unreviewed source change\n";
      expect(changed).not.toBe(original);
      writeFileSync(path.join(root, file), changed);
      const outcome = await NETWORK_ASSUMPTION_SCENARIO.run(makeCtx(root));
      expect(outcome.status).toBe("failed");
      expect(outcome.severity).toBe("major");
      expect(outcome.evidence.filter(e => e.source === "known-intentional local HTTP use")).toHaveLength(1);
    });
  }

  for (const dependency of reviewedFiles.slice(2)) {
    it(`changed caller/precondition ${dependency} invalidates tutorial recognition`, async () => {
      const root = reviewedFixture();
      writeFileSync(path.join(root, dependency), "// changed caller or validation precondition\n");
      const outcome = await NETWORK_ASSUMPTION_SCENARIO.run(makeCtx(root));
      expect(outcome.status).toBe("failed");
      expect(outcome.severity).toBe("major");
      expect(outcome.evidence.filter(e => e.source === "known-intentional local HTTP use").map(e => e.filePath)).toEqual([reviewedFiles[0]]);
    });
  }

  it("missing caller evidence and a familiar filename containing arbitrary fetch cannot be recognized", async () => {
    const root = makeFixtureDir("net-impostor-");
    mkdirSync(path.join(root, "src/tutorial"));
    writeFileSync(path.join(root, reviewedFiles[1]!), readFileSync(path.resolve(reviewedFiles[1]!)));
    let outcome = await NETWORK_ASSUMPTION_SCENARIO.run(makeCtx(root));
    expect(outcome.status).toBe("failed");
    writeFileSync(path.join(root, reviewedFiles[1]!), 'fetch("http://example.invalid/");\n');
    outcome = await NETWORK_ASSUMPTION_SCENARIO.run(makeCtx(root));
    expect(outcome.status).toBe("failed");
    expect(outcome.severity).toBe("major");
  });

  it("readiness refuses remote hosts before fetch and never follows a local redirect", async () => {
    const outDir = makeFixtureDir("net-readiness-");
    const handle = await startManagedProcess({ id: "network-proof", executable: process.execPath,
      args: ["-e", "setInterval(() => {}, 1000)"], cwd: outDir, outDir });
    let destinationRequests = 0;
    const server = http.createServer((req, res) => {
      if (req.url === "/destination") destinationRequests++;
      res.writeHead(302, { location: "/destination" }); res.end();
    });
    try {
      const request = vi.spyOn(globalThis, "fetch");
      const refused = await handle.waitForReadiness({ kind: "http", url: "http://example.invalid/", timeoutMs: 1000 });
      expect(refused.status).toBe("probe-failed");
      expect(refused.attempts).toBe(0);
      expect(request).not.toHaveBeenCalled();
      await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("missing local server");
      const ready = await handle.waitForReadiness({ kind: "http", url: `http://127.0.0.1:${address.port}/`, timeoutMs: 2000 });
      expect(ready.status).toBe("ready");
      expect(request).toHaveBeenCalledTimes(1);
      expect(destinationRequests).toBe(0);
    } finally {
      server.closeAllConnections();
      await new Promise<void>(resolve => server.close(() => resolve()));
      await handle.stop();
    }
  });

  it("obvious fetch usage in bounded source produces evidence and fails", async () => {
    const root = makeFixtureDir("net-fetch-");
    writeFileSync(path.join(root, "src", "client.ts"), 'export async function go() { return fetch("http://example.invalid"); }\n', "utf8");
    const outcome = await NETWORK_ASSUMPTION_SCENARIO.run(makeCtx(root));
    expect(outcome.status).toBe("failed");
    expect(outcome.evidence.some((e) => e.observedBehavior?.includes("fetch-call"))).toBe(true);
  });

  it("obvious axios import in bounded source produces evidence and fails", async () => {
    const root = makeFixtureDir("net-axios-");
    writeFileSync(path.join(root, "src", "client.ts"), 'import axios from "axios";\nexport { axios };\n', "utf8");
    const outcome = await NETWORK_ASSUMPTION_SCENARIO.run(makeCtx(root));
    expect(outcome.status).toBe("failed");
  });

  it("known dependency-validation paths (npm audit style) are labeled network-using, not unexpected violations", async () => {
    const root = makeFixtureDir("net-known-intentional-");
    const depsDir = path.join(root, "src", "securityValidation", "dependencies");
    mkdirSync(depsDir, { recursive: true });
    writeFileSync(path.join(depsDir, "runDependencyChecks.ts"), 'import fetch from "node-fetch";\nexport { fetch };\n', "utf8");
    const outcome = await NETWORK_ASSUMPTION_SCENARIO.run(makeCtx(root));
    // Known-intentional path match must not fail the scenario.
    expect(outcome.status).toBe("passed");
    expect(
      outcome.evidence.some((e) => e.source?.includes("known network-using validation commands"))
    ).toBe(true);
  });

  it("source with no obvious network APIs passes only the bounded static-check claim", async () => {
    const root = makeFixtureDir("net-clean-");
    writeFileSync(path.join(root, "src", "math.ts"), "export function add(a: number, b: number) { return a + b; }\n", "utf8");
    const outcome = await NETWORK_ASSUMPTION_SCENARIO.run(makeCtx(root));
    expect(outcome.status).toBe("passed");
  });

  it("missing/unscannable source skips cleanly (passes with bounded-scan wording, does not crash)", async () => {
    const root = mkdtempSync(path.join(fs.realpathSync.native(os.tmpdir()), "net-empty-"));
    cleanupDirs.push(root);
    const outcome = await NETWORK_ASSUMPTION_SCENARIO.run(makeCtx(root));
    expect(outcome.status).toBe("passed");
    expect(outcome.evidence.some((e) => e.observedBehavior?.includes("nothing to scan"))).toBe(true);
  });

  it("report wording never claims full runtime network isolation", async () => {
    const root = makeFixtureDir("net-wording-");
    writeFileSync(path.join(root, "src", "math.ts"), "export function add(a: number, b: number) { return a + b; }\n", "utf8");
    const outcome = await NETWORK_ASSUMPTION_SCENARIO.run(makeCtx(root));
    const caveat = outcome.evidence.find((e) => e.source === "scope statement");
    expect(caveat?.expectedBehavior).toMatch(/does not prove runtime network isolation/i);
  });

  it("scenario performs no network calls itself (fixture with only local files, deterministic result)", async () => {
    const root = makeFixtureDir("net-no-calls-");
    writeFileSync(path.join(root, "src", "math.ts"), "export function add(a: number, b: number) { return a + b; }\n", "utf8");
    const first = await NETWORK_ASSUMPTION_SCENARIO.run(makeCtx(root));
    const second = await NETWORK_ASSUMPTION_SCENARIO.run(makeCtx(root));
    expect(first.status).toBe(second.status);
  });
});
