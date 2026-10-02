import { lstatSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { relativeWithinRoot, resolveWithinRoot } from "../../core/pathSafety.js";
import { inspectRepositoryFiles } from "./inspection.js";
import type { InspectableFile } from "./inspection.js";
import { computeAggregate, computeRepositoryContentIdentity, describeContent, validateSyntheticRepositoryManifest } from "./manifest.js";
import type { SyntheticManifestFileRecord, SyntheticRepositoryManifestV1 } from "./manifest.js";

const MAX_REPORTED_ISSUES = 50;

export type SyntheticRepositoryVerification =
  | { ok: true; issues: []; manifest: SyntheticRepositoryManifestV1 }
  | { ok: false; issues: string[]; manifest?: SyntheticRepositoryManifestV1 };

function walk(root: string, directory: string, found: string[], issues: string[]): void {
  for (const entry of readdirSync(directory, { withFileTypes: true }).sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0))) {
    const full = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) {
      issues.push(`unexpected symbolic link ${relativeWithinRoot(root, full)}.`);
    } else if (entry.isDirectory()) {
      walk(root, full, found, issues);
    } else {
      found.push(relativeWithinRoot(root, full));
    }
  }
}

function bounded(issues: string[]): string[] {
  if (issues.length <= MAX_REPORTED_ISSUES) return issues;
  return [...issues.slice(0, MAX_REPORTED_ISSUES), `... ${issues.length - MAX_REPORTED_ISSUES} more issue(s) omitted.`];
}

/**
 * Read-only verification of an existing materialization against its manifest. Re-measures every listed file
 * (bytes, chars, estimated tokens, SHA-256), the repository content identity, the aggregate metrics and the
 * realized dimensions (from the files' own content), checks that no unlisted file exists and that the answer-key
 * files exist. Never writes, repairs or deletes. Issues are reported in manifest (path) order.
 */
export function verifySyntheticRepositoryMaterialization(options: { manifestPath: string; repositoryRoot: string }): SyntheticRepositoryVerification {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(options.manifestPath, "utf8"));
  } catch (error) {
    return { ok: false, issues: [`manifest cannot be read as JSON: ${error instanceof Error ? error.message : String(error)}`] };
  }
  const validation = validateSyntheticRepositoryManifest(parsed);
  if (!validation.ok) return { ok: false, issues: bounded(validation.issues) };
  const manifest = validation.manifest;

  const issues: string[] = [];
  const inspectable: InspectableFile[] = [];
  const measured: SyntheticManifestFileRecord[] = [];
  const contents: string[] = [];
  for (const record of manifest.files) {
    let absolute: string;
    try {
      absolute = resolveWithinRoot(options.repositoryRoot, record.path);
    } catch (error) {
      issues.push(`${record.path}: ${error instanceof Error ? error.message : String(error)}`);
      continue;
    }
    let content: string;
    try {
      const stats = lstatSync(absolute);
      if (!stats.isFile()) {
        issues.push(`${record.path}: is not a regular file.`);
        continue;
      }
      content = readFileSync(absolute, "utf8");
    } catch {
      issues.push(`${record.path}: listed file is missing or unreadable.`);
      continue;
    }
    if (content.includes("\r") || content.startsWith("﻿")) issues.push(`${record.path}: contains a carriage return or byte-order mark.`);
    const metrics = describeContent(content);
    for (const key of ["byteLength", "charCount", "estimatedContentTokens", "sha256"] as const) {
      if (metrics[key] !== record[key]) issues.push(`${record.path}: ${key} ${String(metrics[key])} does not match the manifest (${String(record[key])}).`);
    }
    measured.push({ ...record, ...metrics });
    contents.push(content);
    inspectable.push({ path: record.path, role: record.role, content });
  }

  const found: string[] = [];
  try {
    walk(options.repositoryRoot, options.repositoryRoot, found, issues);
  } catch {
    issues.push("repository root cannot be enumerated.");
  }
  const listed = new Set(manifest.files.map((record) => record.path));
  for (const file of found.sort()) if (!listed.has(file)) issues.push(`${file}: file exists but is not listed in the manifest.`);

  if (issues.length === 0) {
    if (computeRepositoryContentIdentity(measured) !== manifest.repositoryContentIdentity) issues.push("repositoryContentIdentity does not match the files.");
    const aggregate = computeAggregate(measured, contents.join(""));
    for (const key of Object.keys(aggregate) as Array<keyof typeof aggregate>) {
      if (aggregate[key] !== manifest.aggregate[key]) issues.push(`aggregate.${key} ${String(aggregate[key])} does not match the manifest (${String(manifest.aggregate[key])}).`);
    }
    const inspection = inspectRepositoryFiles(manifest.language, inspectable);
    issues.push(...inspection.issues);
    for (const key of Object.keys(inspection.dimensions) as Array<keyof typeof inspection.dimensions>) {
      if (inspection.dimensions[key] !== manifest.realizedDimensions[key]) issues.push(`realized ${key} ${inspection.dimensions[key]} measured from files does not match the manifest (${manifest.realizedDimensions[key]}).`);
      if (manifest.requestedDimensions[key] !== manifest.realizedDimensions[key]) issues.push(`requested ${key} ${manifest.requestedDimensions[key]} does not equal realized ${manifest.realizedDimensions[key]}.`);
    }
  }
  if (issues.length > 0) return { ok: false, issues: bounded(issues), manifest };
  return { ok: true, issues: [], manifest };
}
