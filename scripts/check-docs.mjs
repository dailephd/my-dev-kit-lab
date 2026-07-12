import fs from "node:fs";
import path from "node:path";

const root = process.env.DOCS_CHECK_ROOT ? path.resolve(process.env.DOCS_CHECK_ROOT) : process.cwd();
const manifestPath = path.join(root, "docs/documentation-preservation-manifest.json");
const failures = [];
const fail = (file, topic, expected, actual, correction) => failures.push(`${file}: ${topic}; expected ${expected}; actual ${actual}; recommended correction: ${correction}`);
if (!fs.existsSync(manifestPath)) fail("docs/documentation-preservation-manifest.json", "preservation manifest", "a readable manifest", "missing", "restore the tracked manifest");
const manifest = fs.existsSync(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath, "utf8")) : { documents: {} };
const read = (file) => fs.existsSync(path.join(root, file)) ? fs.readFileSync(path.join(root, file), "utf8") : "";

for (const [file, rules] of Object.entries(manifest.documents)) {
  const body = read(file);
  if (!body) { fail(file, "document", "present and non-empty", "missing or empty", "restore the document"); continue; }
  for (const section of rules.requiredSections ?? []) if (!new RegExp(`^#{1,4}\\s+.*${escape(section)}`, "im").test(body)) fail(file, `section ${section}`, "a heading", "missing", `restore the ${section} heading and its detailed content`);
  for (const topic of rules.topics ?? []) if (!body.toLowerCase().includes(topic.toLowerCase())) fail(file, `topic ${topic}`, "present", "missing", `restore coverage of ${topic}`);
  for (const status of rules.statusMarkers ?? []) if (!body.includes(status)) fail(file, `status marker ${status}`, "present", "missing", "restore the agreed status wording");
  for (const forbidden of rules.forbiddenRanges ?? []) if (body.includes(forbidden)) fail(file, `range substitution ${forbidden}`, "absent", "present", "restore every individual version section");
  for (const version of rules.releasedVersions ?? []) if (!new RegExp(`^##\\s+\\[?v?${escape(version)}(?:\\]|\\s|$)`, "mi").test(body)) fail(file, `released version ${version}`, "a CHANGELOG heading", "missing", `restore the ${version} release entry`);
}

const roadmap = read("docs/ROADMAP.md");
const requiredVersions = manifest.documents?.["docs/ROADMAP.md"]?.requiredVersions ?? [];
const actualVersions = [...roadmap.matchAll(/^###\s+(v\d+\.\d+\.\d+)\b/gm)].map((match) => match[1]);
for (const version of requiredVersions) if (!actualVersions.includes(version)) fail("docs/ROADMAP.md", `version ${version}`, "an individual ### heading", "missing", `restore the detailed ${version} plan`);
let previous = -1;
for (const version of requiredVersions) { const index = actualVersions.indexOf(version); if (index >= 0 && index <= previous) fail("docs/ROADMAP.md", `semantic order at ${version}`, "after the preceding required version", `position ${index}`, "restore semantic version order"); previous = Math.max(previous, index); }
if (/###\s+v0\.4\.0[^\n]*(manual pentest)|v0\.4\.0[\s\S]{0,180}Status:[^\n]*(manual pentest)/i.test(roadmap)) fail("docs/ROADMAP.md", "manual pentest placement", "post-v1 / version TBD", "assigned to v0.4.0", "move the human-led pentest plan to post-v1 without deleting it");
if (/###\s+v0\.4\.2[\s\S]{0,220}Status:[^\n]*published/i.test(roadmap)) fail("docs/ROADMAP.md", "v0.4.2 release state", "unreleased", "published", "mark v0.4.2 implemented on its feature branch but unreleased");

const pkg = JSON.parse(read("package.json") || "{}");
if (pkg.version !== "0.4.1") fail("package.json", "package version", "0.4.1", String(pkg.version), "do not version-bump during documentation recovery");
for (const script of ["experiment:list", "experiment:describe", "experiment:run", "audit", "security:validate", "docs:check", "verify"]) if (!pkg.scripts?.[script]) fail("package.json", `script ${script}`, "implemented", "missing", `restore the ${script} script or update the manifest with explicit authorization`);

const all = Object.keys(manifest.documents).map(read).join("\n");
for (const [pattern, message, correction] of [
  [/v0\.4\.1[^.;\n]*(unreleased|implementation-complete but unreleased)/i, "v0.4.1 release state", "mark v0.4.1 published"],
  [/v0\.4\.2[^\n]*published/i, "v0.4.2 release state", "mark v0.4.2 unreleased"],
  [/automated (security )?validation (is|counts as|provides) (a )?manual pentest/i, "automated/manual boundary", "describe automated validation and manual pentest as distinct workflows"]
]) if (pattern.test(all)) fail("documentation", message, "the agreed planning boundary", "contradictory wording", correction);

if (failures.length) { console.error("Documentation consistency check failed:"); for (const failure of failures) console.error(`- ${failure}`); process.exitCode = 1; }
else console.log(`Documentation consistency check passed (${Object.keys(manifest.documents).length} manifested documents, ${requiredVersions.length} preserved roadmap versions).`);

function escape(value) { return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
