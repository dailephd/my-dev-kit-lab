import { afterEach, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createKitLaunchGuard, type KitLaunchEvent } from "../../src/audits/core/kitLaunchGuard.js";
import { createKitStreamTransport, type KitStreamEvent } from "../../src/audits/core/kitStreamTransport.js";
import { runMeasuredCommand } from "../../src/core/runMeasuredCommand.js";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});
const identity = { snapshotId: "a".repeat(64), selectionFingerprint: "b".repeat(64) };
const program = [
  'const readline = require("node:readline");',
  'const {createHash} = require("node:crypto");',
  'const lines = readline.createInterface({input: process.stdin});',
  'lines.on("line", line => {',
  '  const request = JSON.parse(line);',
  '  const item = request.requests[0];',
  '  if (item.page === 700) { process.stdout.write("{"); process.exitCode = 9; lines.close(); process.stdin.destroy(); return; }',
  '  if (item.page === 701) { process.stderr.write("noise"); return; }',
  '  if (item.page === 702) { return; }',
  '  const digest = createHash("sha256").update(line).digest("hex");',
  '  const ok = item.page !== 699;',
  '  if (!ok) process.exitCode = 2;',
  '  const result = ok ? { id:item.id, selector:item.selector, status:"ok", response:{ page:item.page, testModifierProof:item.testModifierProof } } :',
  '    { id:item.id, selector:item.selector, status:"error", error:{ exitCode:2, code:"STALE_SOURCE_EVIDENCE" } };',
  '  process.stdout.write(JSON.stringify({schemaVersion:"1.0.0",requestId:request.requestId,',
  '    status:ok?"complete":"incomplete",batch:{',
  '      schemaVersion:"1.0.0",mode:"audit-batch",family:process.argv[1],snapshotId:' +
    JSON.stringify(identity.snapshotId) + ',selectionFingerprint:' + JSON.stringify(identity.selectionFingerprint) + ',',
  '      inputSha256:digest,requestedCount:1,returnedCount:1,complete:ok,results:[result]',
  '  }}) + "\\n");',
  '});',
].join("\n");

function fixture({ limit = 20, frameLimit, timeoutMs = 5000 }: { limit?: number; frameLimit?: number; timeoutMs?: number } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lab-stream-test-"));
  dirs.push(root);
  let i = 0;
  const events: KitLaunchEvent[] = [];
  const streams: KitStreamEvent[] = [];
  const guard = createKitLaunchGuard(limit);
  const stream = createKitStreamTransport({
    identity, frameLimit, timeoutMs, signal: guard.signal,
    launch(family, interaction, signal) {
      const commandId = "fixture-" + String(++i);
      const attempt = guard.attempt(commandId, family + "-stream", event => events.push(event));
      return runMeasuredCommand({ commandId, cwd: root, outDir: root, executable: process.execPath,
        args: ["-e", program, family], resolveCommand: false, interaction, signal, terminateProcessTree: true,
        beforeSpawn: attempt.beforeSpawn, onSpawn: attempt.started,
        onSettled: result => attempt.settled(result.exitCode, signal.aborted) });
    },
    itemError: code => new Error(code),
    observe: event => streams.push(event),
  });
  const ask = (page: number) => stream.query("lookup", { selector: "audit-files", page });
  return { ask, stream, events, streams, guard };
}

it("settles typed item failures and restarts only after the permitted frame count", async () => {
  const f = fixture({ frameLimit: 2 });
  expect(await f.ask(0)).toEqual({ page: 0 });
  await expect(f.ask(699)).rejects.toThrow(/STALE_SOURCE_EVIDENCE/);
  expect(await f.ask(1)).toEqual({ page: 1 });
  await f.stream.close();
  expect(f.events.filter(e => e.status === "started")).toHaveLength(2);
  expect(f.events.filter(e => e.status === "completed").map(e => e.exitCode)).toEqual([2, 0]);
  expect(f.streams.filter(e => e.type === "retiring").map(e => e.reason)).toEqual(["frame-limit", "dispose"]);
});

it("authenticates the negotiation member in the same stream frame as the exact selector", async () => {
  const f = fixture();
  const path = "tests/probe.spec.ts";
  try {
    expect(await f.stream.query("lookup", { selector: "audit-file", path, page: 0, testModifierProof: true }))
      .toEqual({ page: 0, testModifierProof: true });
    expect(await f.stream.query("lookup", { selector: "audit-file", path, page: 0 })).toEqual({ page: 0 });
    expect(await f.stream.query("lookup", { selector: "audit-file", path, page: 1 })).toEqual({ page: 1 });
  } finally { await f.stream.close(); }
});

it("refuses the next rollover before process start when the shared guard is exhausted", async () => {
  const f = fixture({ frameLimit: 1, limit: 1 });
  expect(await f.ask(0)).toEqual({ page: 0 });
  await expect(f.ask(1)).rejects.toThrow(/budget exhausted/);
  await f.stream.close();
  expect(f.events.filter(e => e.status === "started")).toHaveLength(1);
  expect(f.events.filter(e => e.status === "refused")).toHaveLength(1);
});

it.each([[700, /truncated/], [701, /stderr/], [702, /timed out/]] as const)(
  "rejects each queued caller on a fatal pipe failure %i",
  async (page, message) => {
    const f = fixture({ timeoutMs: 2500 });
    const results = await Promise.allSettled([f.ask(page), f.ask(0), f.ask(1)]);
    for (const result of results) {
      expect(result.status).toBe("rejected");
      if (result.status === "rejected") expect(String(result.reason)).toMatch(message);
    }
    await f.stream.close();
    expect(f.events.filter(e => e.status === "started")).toHaveLength(1);
    expect(f.events.filter(e => ["completed", "cancelled"].includes(e.status))).toHaveLength(1);
  }, 15_000,
);

it("caps pending clients and rejects all queued promises after disposal", async () => {
  const f = fixture();
  const settled = Promise.allSettled(Array.from({ length: 513 }, (_, i) => f.ask(i)));
  await f.stream.close();
  const states = await settled;
  expect(states.filter(s => s.status === "rejected")).toHaveLength(513);
  expect(states.some(s => s.status === "rejected" && /pending request limit/.test(String(s.reason)))).toBe(true);
  await expect(f.ask(0)).rejects.toThrow(/cancelled|closed/);
});

it("refuses oversized input before opening a child", async () => {
  const f = fixture();
  await expect(f.stream.query("source", {
    selector: "exact-file-occurrence", path: "src/a.ts", literal: "x".repeat(65_536), context: 3,
  })).rejects.toMatchObject({ category: "output-limit" });
  await f.stream.close();
  expect(f.events).toEqual([]);
});
