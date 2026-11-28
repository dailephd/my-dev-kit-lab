import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { runMeasuredCommand } from "../../src/core/runMeasuredCommand.js";
import { createKitBatchTransport, type KitBatchPacket } from "../../src/audits/core/kitBatchTransport.js";
import { createKitLaunchGuard, type KitLaunchEvent } from "../../src/audits/core/kitLaunchGuard.js";
import { sha256Hex } from "../../src/audits/core/kitSourceEvidence.js";

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });
const identity = { snapshotId: "1".repeat(64), selectionFingerprint: "2".repeat(64) };

function envelope(packet: KitBatchPacket, incomplete = false) {
  const { requests } = JSON.parse(packet.bytes.toString()) as { requests: Array<{ id: string; selector: string }> };
  return {
    schemaVersion: "1.0.0", mode: "audit-batch", family: packet.family, ...identity,
    inputSha256: sha256Hex(packet.bytes), requestedCount: requests.length, returnedCount: requests.length, complete: !incomplete,
    results: requests.map(({ id, selector }, index) => incomplete && index === 0 ?
      { id, selector, status: "error", error: { code: "STALE_SOURCE_EVIDENCE", exitCode: 2 } } :
      { id, selector, status: "ok", response: { marker: id } }),
  };
}

it.each(["reordered", "duplicate", "missing", "snapshot", "selection", "input digest", "unknown field", "exit contradiction"])(
  "fails the entire invalid batch envelope for %s",
  async kind => {
    const transport = createKitBatchTransport({
      identity, signal: new AbortController().signal, itemError: code => new Error(code),
      async execute(packet) {
        const body = envelope(packet);
        if (kind === "reordered") body.results.reverse();
        if (kind === "duplicate") body.results[1] = body.results[0]!;
        if (kind === "missing") body.results.pop();
        if (kind === "snapshot") body.snapshotId = "3".repeat(64);
        if (kind === "selection") body.selectionFingerprint = "3".repeat(64);
        if (kind === "input digest") body.inputSha256 = "3".repeat(64);
        if (kind === "unknown field") Object.assign(body, { extra: true });
        return { exit: kind === "exit contradiction" ? 2 : 0, body };
      },
    });
    const badFallback = () => Promise.reject(new Error("unexpected standalone fallback"));
    const settled = await Promise.allSettled([0, 1].map(page => transport("lookup", { selector: "audit-files", page }, badFallback)));
    for (const row of settled) {
      expect(row.status).toBe("rejected");
      if (row.status === "rejected") expect(row.reason).toMatchObject({ category: "artifact-invalid" });
    }
  }
);

it("quarantines an incomplete response and independently recovers only its sibling", async () => {
  let fallback = 0;
  const transport = createKitBatchTransport({
    identity, signal: new AbortController().signal, itemError: code => new Error(code),
    async execute(packet) { return { exit: 2, body: envelope(packet, true) }; },
  });
  const settled = await Promise.allSettled([0, 1].map(page => transport("lookup", { selector: "audit-files", page },
    async () => { fallback++; return "validated by standalone"; })));
  expect(settled).toEqual([
    { status: "rejected", reason: new Error("STALE_SOURCE_EVIDENCE") },
    { status: "fulfilled", value: "validated by standalone" },
  ]);
  expect(fallback).toBe(1);
});

it("includes negotiated page zero in authenticated batch identity and preserves its standalone recovery", async () => {
  const path = "tests/probe.spec.ts";
  const bySelector = [
    { selector: "audit-files", page: 0 },
    { selector: "audit-file", path, page: 0, testModifierProof: true },
    { selector: "audit-file", path, page: 1 },
  ] as const;
  const recovered: unknown[] = [];
  const transport = createKitBatchTransport({
    identity, signal: new AbortController().signal, itemError: code => new Error(code),
    async execute(packet) {
      const { requests } = JSON.parse(packet.bytes.toString());
      expect(requests).toEqual(bySelector.map((item, index) => ({ ...item, id: String(index + 1) })));
      return { exit: 2, body: envelope(packet, true) };
    },
  });
  const results = await Promise.allSettled(bySelector.map(item => transport("lookup", item, async fallback => {
    expect(fallback?.reason).toBe("incomplete");
    recovered.push(item);
  })));
  expect(results.map(result => result.status)).toEqual(["rejected", "fulfilled", "fulfilled"]);
  expect(recovered).toEqual(bySelector.slice(1));
});

it("bounds request count, input bytes and output-limit fallback", async () => {
  const fills: number[] = [];
  let independent = 0;
  const transport = createKitBatchTransport({
    identity, signal: new AbortController().signal, itemError: code => new Error(code),
    async execute(packet) {
      fills.push(packet.count);
      expect(packet.count).toBeLessThanOrEqual(32);
      expect(packet.bytes.length).toBeLessThanOrEqual(64 * 1024);
      return { exit: "producer-output-limit" };
    },
  });
  await Promise.all(Array.from({ length: 33 }, (_, page) => transport("lookup", { selector: "audit-files", page },
    async () => { independent++; })));
  expect(fills).toEqual([32]);
  await Promise.all(Array.from({ length: 20 }, (_, page) => transport("lookup", {
    selector: "audit-file", path: "a".repeat(4096) + page, page: 0,
  }, async () => { independent++; })));
  expect(fills.slice(1)).toEqual([15, 5]);
  expect(independent).toBe(53);
});

it("cancels all queued and active requests without standalone recovery", async () => {
  const controller = new AbortController();
  const transport = createKitBatchTransport({
    identity, signal: controller.signal, itemError: code => new Error(code),
    async execute(packet) {
      await new Promise<void>(resolve => controller.signal.addEventListener("abort", () => resolve(), { once: true }));
      return { exit: 0, body: envelope(packet) };
    },
  });
  const results = Promise.allSettled(Array.from({ length: 100 }, (_, page) =>
    transport("lookup", { selector: "audit-files", page }, () => Promise.resolve("unexpected fallback"))));
  queueMicrotask(() => controller.abort());
  expect((await results).every(row => row.status === "rejected")).toBe(true);
  await expect(transport("lookup", { selector: "audit-files", page: 0 }, async () => {})).rejects.toThrow(/cancelled/);
});

it("refuses reservation 5001 with concurrent measured-runner attempts at the spawn boundary", async () => {
  const events: KitLaunchEvent[] = [];
  const guard = createKitLaunchGuard();
  for (let i = 0; i < 4998; i++) {
    const prior = guard.attempt(String(i), "index", () => {});
    prior.beforeSpawn();
    prior.started();
    prior.settled(0, false);
  }
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "kit-guard-"));
  dirs.push(root);
  const launch = (index: number, executable = process.execPath) => {
    const commandId = "probe-" + index;
    const state = guard.attempt(commandId, "lookup-batch", event => events.push(event));
    return runMeasuredCommand({ commandId, cwd: root, outDir: root, executable, args: ["-e", "process.exitCode = 0"],
      signal: guard.signal, beforeSpawn: state.beforeSpawn, onSpawn: state.started,
      onSettled: result => state.settled(result.exitCode, false), resolveCommand: false });
  };
  // Reserve one failed OS spawn and one real start. The failed reservation is
  // deliberately never recycled, so no later attempt can race with settlement.
  const failed = await launch(-1, path.join(root, "nonexistent.exe"));
  expect(failed.exitCode).toBeNull();
  const results = await Promise.allSettled(Array.from({ length: 40 }, (_, i) => launch(i)));
  expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1);
  expect(events.filter(e => e.status === "started")).toHaveLength(1);
  expect(events.filter(e => e.status === "failed-to-start")).toHaveLength(1);
  expect(events.filter(e => e.status === "refused")).toHaveLength(39);
  expect(events.filter(e => e.status === "reserved").map(e => e.reservation)).toEqual([4999, 5000]);
  expect(events.filter(e => e.status === "completed")).toMatchObject([{ exitCode: 0, reservation: 5000 }]);
  guard.close();
  await expect(launch(41)).rejects.toThrow(/cancellation/);
});
