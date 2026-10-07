import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildMyDevKitIndex, runMyDevKitRetrieval } from "../../src/evaluation/runMyDevKitRetrieval.js";
import { makeTempDir, minimalCase, readKitLog, writeRecordingFakeKit } from "../experiments/contextWindowScaling/localSubjectFixture.js";
import { removeTempDir } from "./localRepositorySubject/fixtureRepository.js";

let directory: string;
let kitCommand: string;
let logPath: string;
beforeEach(() => {
  directory = makeTempDir("lrs-retrieval-");
  kitCommand = writeRecordingFakeKit(directory).command;
  logPath = path.join(directory, "log.jsonl");
  process.env.LRS_FAKE_KIT_LOG = logPath;
});
afterEach(() => {
  delete process.env.LRS_FAKE_KIT_LOG;
  removeTempDir(directory);
});

const target = () => ({ absoluteTargetRoot: path.join(directory, "target"), sourceRoots: ["src", "lib"] });

describe("RSP-004 guided index exclusions are additive", () => {
  it("keeps the exact legacy index arguments when no exclusions are supplied", async () => {
    const indexDir = path.join(directory, "idx");
    for (const options of [{}, { excludePaths: [] as string[] }]) {
      await buildMyDevKitIndex({ target: target(), kitCommand, indexDir, commandsDir: path.join(directory, "cmds"), requireKit: true, ...options });
    }
    const logged = readKitLog(logPath);
    expect(logged).toHaveLength(2);
    for (const entry of logged) {
      expect(entry.argv).toEqual(["index", "--root", target().absoluteTargetRoot, "--src", "src", "--src", "lib", "--out", indexDir, "--json"]);
    }
  });

  it("adds one --exclude per path, in order, after the --src arguments and before --out", async () => {
    const indexDir = path.join(directory, "idx");
    await buildMyDevKitIndex({
      target: target(),
      kitCommand,
      indexDir,
      commandsDir: path.join(directory, "cmds"),
      requireKit: true,
      excludePaths: ["src/gen", "src/ignored.ts"],
    });
    expect(readKitLog(logPath)[0].argv).toEqual([
      "index", "--root", target().absoluteTargetRoot, "--src", "src", "--src", "lib",
      "--exclude", "src/gen", "--exclude", "src/ignored.ts", "--out", indexDir, "--json",
    ]);
  });

  it("passes the exclusions only to the index command of the full retrieval lifecycle", async () => {
    const evaluationCase = { ...minimalCase(), absoluteTargetRoot: target().absoluteTargetRoot, sourceRoots: ["src"], targetRoot: "x", benchmarkProject: "p" } as never;
    await runMyDevKitRetrieval({ evaluationCase, kitCommand, outputDir: path.join(directory, "out"), requireKit: true, excludePaths: ["src/gen"] });
    const commands = readKitLog(logPath).map((entry) => entry.argv);
    expect(commands.map((argv) => argv[0])).toEqual(["index", "search", "lookup", "slice", "source"]);
    expect(commands[0]).toContain("--exclude");
    for (const argv of commands.slice(1)) expect(argv).not.toContain("--exclude");
    expect(commands[0][commands[0].indexOf("--out") + 1].startsWith(path.join(directory, "out"))).toBe(true);
  });
});

describe("buildMyDevKitIndex callGraph is additive", () => {
  const legacy = (indexDir: string) => ["index", "--root", target().absoluteTargetRoot, "--src", "src", "--src", "lib", "--out", indexDir, "--json"];
  const run = (extra: Record<string, unknown> = {}) =>
    buildMyDevKitIndex({ target: target(), kitCommand, indexDir: path.join(directory, "idx"), commandsDir: path.join(directory, "cmds"), requireKit: true, ...extra });

  it("keeps the exact legacy command when callGraph is omitted or false", async () => {
    await run();
    await run({ callGraph: false });
    const logged = readKitLog(logPath);
    expect(logged).toHaveLength(2);
    for (const entry of logged) expect(entry.argv).toEqual(legacy(path.join(directory, "idx")));
  });

  it("adds exactly one --call-graph after --out when callGraph is true", async () => {
    await run({ callGraph: true });
    const [entry] = readKitLog(logPath);
    expect(entry.argv).toEqual(["index", "--root", target().absoluteTargetRoot, "--src", "src", "--src", "lib", "--out", path.join(directory, "idx"), "--call-graph", "--json"]);
    expect(entry.argv.filter((arg) => arg === "--call-graph")).toHaveLength(1);
  });

  it("keeps exclusion order and semantics when combined with callGraph", async () => {
    await run({ callGraph: true, excludePaths: ["src/gen", "src/ignored.ts"] });
    expect(readKitLog(logPath)[0].argv).toEqual([
      "index", "--root", target().absoluteTargetRoot, "--src", "src", "--src", "lib",
      "--exclude", "src/gen", "--exclude", "src/ignored.ts", "--out", path.join(directory, "idx"), "--call-graph", "--json",
    ]);
  });

  it("leaves incremental mode arguments in place and only adds the flag to the index command", async () => {
    await run({ callGraph: true, requireKit: false, mode: { kind: "incremental", refreshScope: "changed-files" } });
    const [entry] = readKitLog(logPath);
    expect(entry.argv).toEqual(expect.arrayContaining(["--call-graph", "--incremental", "--refresh-scope", "changed-files", "--json"]));
    expect(entry.argv.indexOf("--call-graph")).toBeLessThan(entry.argv.indexOf("--incremental"));
    expect(entry.argv[entry.argv.length - 1]).toBe("--json");
  });

  it("never passes --call-graph to retrieval commands of the legacy lifecycle", async () => {
    const evaluationCase = { ...minimalCase(), absoluteTargetRoot: target().absoluteTargetRoot, sourceRoots: ["src"], targetRoot: "x", benchmarkProject: "p" } as never;
    await runMyDevKitRetrieval({ evaluationCase, kitCommand, outputDir: path.join(directory, "out"), requireKit: true });
    const commands = readKitLog(logPath).map((entry) => entry.argv);
    expect(commands.map((argv) => argv[0])).toEqual(["index", "search", "lookup", "slice", "source"]);
    for (const argv of commands) expect(argv).not.toContain("--call-graph");
  });
});