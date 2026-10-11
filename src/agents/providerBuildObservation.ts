import { createHash } from "node:crypto";
import { lstat, mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { resolveCommand } from "../core/resolveCommand.js";
import { runMeasuredCommand } from "../core/runMeasuredCommand.js";

/** Opaque producer-owned launch authority, not a command override or an asserted digest. */
export type TrustedProviderExecutable = Readonly<{ providerId: "codex" | "claude" }>;
type FileProof = { alias: string; actual: string; digest: string };
type Launch = { executable: string; prefix: string[]; files: FileProof[]; bytes: Buffer };
const launches = new WeakMap<TrustedProviderExecutable, Launch>();
const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const fail = (): never => { throw new Error("PROVIDER_BUILD_UNVERIFIABLE: use a native executable or an attributable node entrypoint; unsupported wrappers cannot authorize a campaign."); };

async function inspect(alias: string): Promise<{ proof: FileProof; bytes: Buffer }> {
  const actual = await realpath(alias);
  const stat = await lstat(actual);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 256 * 1024 * 1024 || stat.size === 0) return fail();
  const bytes = await readFile(actual);
  if (bytes.length !== stat.size || await realpath(alias) !== actual) return fail();
  return { proof: { alias: path.resolve(alias), actual, digest: hash(bytes) }, bytes };
}
function native(bytes: Buffer): boolean {
  return bytes.subarray(0, 2).toString() === "MZ" || bytes.subarray(0, 4).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46])) || ["feedface", "feedfacf", "cefaedfe", "cffaedfe", "cafebabe"].includes(bytes.subarray(0, 4).toString("hex"));
}

/** Read-only task-free observation. All temporary version diagnostics are removed. No shell templates. */
export async function observeProviderBuild(providerId: "codex" | "claude", options: { env?: NodeJS.ProcessEnv } = {}): Promise<TrustedProviderExecutable> {
  if (providerId !== "codex" && providerId !== "claude") return fail();
  const cwd = await mkdtemp(path.join(os.tmpdir(), "lab-provider-build-"));
  try {
    const env = { ...process.env, ...options.env };
    const resolved = resolveCommand(providerId, { cwd, env, allowPowerShellShim: false });
    if (!resolved.resolvedPath || resolved.resolutionKind === "unavailable") return fail();
    const selected = await inspect(resolved.resolvedPath);
    let executable = selected.proof.actual;
    const prefix: string[] = [];
    const files = [selected.proof];
    let limitation = "Observed launch bytes only; transitive dependencies are not attested.";
    if (!native(selected.bytes)) {
      const text = selected.bytes.toString("utf8");
      // A deliberately closed, attributable wrapper subset. Never execute arbitrary wrapper text.
      const cmd = /^@echo off\r?\n(?:node|"([^"\r\n]+)") "([^"\r\n]+)" %\*\r?\n?$/i.exec(text);
      const shebang = /^#!\/usr\/bin\/env node\r?\n/.test(text);
      if (!cmd && !shebang) return fail();
      const node = resolveCommand(cmd?.[1] ?? "node", { cwd, env, allowPowerShellShim: false });
      if (!node.resolvedPath || node.resolutionKind === "unavailable") return fail();
      const interpreter = await inspect(node.resolvedPath);
      if (!native(interpreter.bytes)) return fail();
      files.push(interpreter.proof);
      executable = interpreter.proof.actual;
      if (cmd) {
        if (!path.isAbsolute(cmd[2]!)) return fail();
        const entry = await inspect(cmd[2]!);
        files.push(entry.proof); prefix.push(entry.proof.actual);
      } else prefix.push(selected.proof.actual);
      limitation = "Restricted node wrapper, interpreter and entrypoint bytes observed; transitive dependencies are not attested.";
    }
    const version = await runMeasuredCommand({ commandId: `${providerId}-build-version`, executable, args: [...prefix, "--version"], resolveCommand: false, cwd, outDir: cwd, env, timeoutMs: 5000, stdoutMaxBytes: 4096, stderrMaxBytes: 4096, terminateProcessTree: true });
    const observedVersion = version.stdout.trim();
    if (!version.ok || version.timedOut || version.outputLimit || !/^[\x20-\x7e]{1,512}$/.test(observedVersion) || !/\d+\.\d+/.test(observedVersion)) return fail();
    const capability = Object.freeze({ providerId });
    const bytes = Buffer.from(JSON.stringify({ contract: "local-provider-launch-v1", providerId, origin: "inspected-local-executable", executable, prefix, files, version: observedVersion, adapterContract: `${providerId}-fixed-stdin-v1`, limitation }));
    launches.set(capability, { executable, prefix, files, bytes });
    await trustedProviderObservation(capability, providerId);
    return capability;
  } catch { return fail(); } finally { await rm(cwd, { recursive: true, force: true }); }
}

export async function trustedProviderObservation(capability: TrustedProviderExecutable, providerId: "codex" | "claude"): Promise<Buffer> {
  const launch = launches.get(capability);
  if (!launch || capability.providerId !== providerId) return fail();
  for (const file of launch.files) {
    const current = await inspect(file.alias);
    if (current.proof.actual !== file.actual || current.proof.digest !== file.digest) throw new Error("PROVIDER_BUILD_CHANGED");
  }
  return Buffer.from(launch.bytes);
}

/** Fixed adapter args are appended by the adapter owner; no PATH lookup occurs on this launch. */
export async function trustedProviderLaunch(capability: TrustedProviderExecutable, providerId: "codex" | "claude") {
  await trustedProviderObservation(capability, providerId);
  const launch = launches.get(capability)!;
  return { executable: launch.executable, prefix: [...launch.prefix] };
}
