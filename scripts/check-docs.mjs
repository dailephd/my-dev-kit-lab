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
const roadmapHeadingMatches = [...roadmap.matchAll(/^###\s+(v\d+\.\d+\.\d+)\b.*$/gm)];
const actualVersions = roadmapHeadingMatches.map((match) => match[1]);
for (const version of requiredVersions) if (!actualVersions.includes(version)) fail("docs/ROADMAP.md", `version ${version}`, "an individual ### heading", "missing", `restore the detailed ${version} plan`);
let previous = -1;
for (const version of requiredVersions) { const index = actualVersions.indexOf(version); if (index >= 0 && index <= previous) fail("docs/ROADMAP.md", `semantic order at ${version}`, "after the preceding required version", `position ${index}`, "restore semantic version order"); previous = Math.max(previous, index); }
if (/###\s+v0\.4\.0[^\n]*(manual pentest)|v0\.4\.0[\s\S]{0,180}Status:[^\n]*(manual pentest)/i.test(roadmap)) fail("docs/ROADMAP.md", "manual pentest placement", "post-v1 / version TBD", "assigned to v0.4.0", "move the human-led pentest plan to post-v1 without deleting it");

// --- Version-aware, state-aware release lifecycle validation -------------------------------------------------
//
// The checker must never hardcode a single "current" package version or a single
// permanently-unpublished version. Instead it parses each `### vX.Y.Z` roadmap section's
// `Status:` line, classifies that text (published / release-prepared / unreleased /
// implementation-complete / future / planned / deferred / canceled / superseded), and uses
// that classification to validate the *actual* package.json version and to check that no
// other manifested document contradicts the roadmap's canonical release state for any version.
//
// Negation precedence: "not published", "not yet published", "unpublished", "unreleased",
// and "publication pending" must never be treated as a positive publication claim merely
// because the substring "published" also appears in the same text.

function parseRoadmapSections(body, headingMatches) {
  const sections = new Map();
  for (let i = 0; i < headingMatches.length; i++) {
    const match = headingMatches[i];
    const version = match[1].slice(1); // drop leading "v"
    const start = match.index + match[0].length;
    const end = i + 1 < headingMatches.length ? headingMatches[i + 1].index : body.length;
    const sectionBody = body.slice(start, end);
    const statusMatch = sectionBody.match(/^\s*Status:\s*(.+)$/m);
    sections.set(version, {
      heading: match[0].trim(),
      body: sectionBody,
      status: statusMatch ? statusMatch[1].trim() : null,
    });
  }
  return sections;
}

const NEGATED_PUBLICATION_PATTERN = /\b(?:not\s+(?:yet\s+)?published|unpublished|unreleased|publication\s+pending|pending\s+publication)\b/i;
const POSITIVE_PUBLICATION_PATTERN = /\bpublished\b/i;
const RELEASE_PREPARED_PATTERN = /release[- ]prepared|release\s+candidate/i;
const IMPLEMENTATION_COMPLETE_PATTERN = /implementation[- ]complete|implemented(?:\s+but)?/i;
const INCOMPATIBLE_LIFECYCLE_PATTERN = /\b(future|planned|not[- ]started|deferred|cancel(?:l)?ed|superseded)\b/i;

function isNegativelyPublished(text) { return NEGATED_PUBLICATION_PATTERN.test(text); }
function isPositivelyPublished(text) { return !isNegativelyPublished(text) && POSITIVE_PUBLICATION_PATTERN.test(text); }

function classifyReleaseStatus(statusText) {
  const unreleased = isNegativelyPublished(statusText);
  const published = isPositivelyPublished(statusText);
  const releasePrepared = RELEASE_PREPARED_PATTERN.test(statusText);
  const implementationComplete = IMPLEMENTATION_COMPLETE_PATTERN.test(statusText);
  const incompatibleLifecycle = INCOMPATIBLE_LIFECYCLE_PATTERN.test(statusText);
  const hasCompatibleMarker = published || releasePrepared || unreleased || implementationComplete;
  return { published, unreleased, releasePrepared, implementationComplete, incompatibleLifecycle, hasCompatibleMarker };
}

// A Status line is compatible with being the *current* package.json version when it
// describes a real, current-package-shaped lifecycle state (published, release-prepared,
// unreleased/implementation-complete) and is not purely a future/planned/deferred/
// canceled/superseded entry.
function isCurrentPackageStatusCompatible(statusText) {
  const classified = classifyReleaseStatus(statusText);
  if (classified.incompatibleLifecycle && !classified.hasCompatibleMarker) return false;
  return classified.hasCompatibleMarker;
}

const roadmapSections = parseRoadmapSections(roadmap, roadmapHeadingMatches);

const pkg = JSON.parse(read("package.json") || "{}");
const SEMVER_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const currentVersion = String(pkg.version ?? "");
if (!SEMVER_PATTERN.test(currentVersion)) {
  fail("package.json", "package version", "a valid semantic version", currentVersion || "missing", "set package.json version to a valid semantic version");
} else {
  const currentSection = roadmapSections.get(currentVersion);
  if (!currentSection) {
    fail("docs/ROADMAP.md", `current package version ${currentVersion}`, `a matching ### v${currentVersion} heading`, "missing", `add a ### v${currentVersion} roadmap section describing the current package state`);
  } else if (!currentSection.status) {
    fail("docs/ROADMAP.md", `v${currentVersion} Status line`, "a Status: line", "missing", `add a Status: line to the ### v${currentVersion} section`);
  } else if (!isCurrentPackageStatusCompatible(currentSection.status)) {
    fail("docs/ROADMAP.md", `v${currentVersion} release state`, "a current package-compatible status (e.g. published, release-prepared, unreleased, implementation complete)", currentSection.status, "align package metadata with the matching ROADMAP version section and use a current package-compatible status such as published or release-prepared/unreleased");
  }
  for (const script of ["experiment:list", "experiment:describe", "experiment:run", "audit", "security:validate", "docs:check", "verify"]) if (!pkg.scripts?.[script]) fail("package.json", `script ${script}`, "implemented", "missing", `restore the ${script} script or update the manifest with explicit authorization`);
}

// Cross-document publication-state consistency: for every roadmap version with an
// unambiguous canonical state (positively published, or explicitly unreleased/unpublished),
// no other manifested document may contradict it. Negated wording ("not yet published",
// "unreleased", "unpublished") must never be misread as a positive publication claim.
const ANY_VERSION_MENTION_PATTERN = /v?\d+\.\d+\.\d+\b/gi;
const PARAGRAPH_BREAK_PATTERN = /\r?\n\s*\r?\n/g;

function findVersionMentionWindows(text, version, windowChars) {
  const re = new RegExp(`v${escape(version)}\\b`, "gi");
  const windows = [];
  let match;
  while ((match = re.exec(text))) {
    const mentionEnd = match.index + match[0].length;
    const charCap = Math.min(text.length, mentionEnd + windowChars);
    ANY_VERSION_MENTION_PATTERN.lastIndex = mentionEnd;
    const nextMention = ANY_VERSION_MENTION_PATTERN.exec(text);
    const nextMentionBoundary = nextMention ? nextMention.index : text.length;
    PARAGRAPH_BREAK_PATTERN.lastIndex = mentionEnd;
    const nextParagraphBreak = PARAGRAPH_BREAK_PATTERN.exec(text);
    const paragraphBoundary = nextParagraphBreak ? nextParagraphBreak.index : text.length;
    const end = Math.min(charCap, nextMentionBoundary, paragraphBoundary);
    windows.push(text.slice(match.index, end));
  }
  return windows;
}

const allDocumentsText = Object.keys(manifest.documents).map(read).join("\n");
for (const [version, section] of roadmapSections) {
  if (!section.status) continue;
  const canonicalPublished = isPositivelyPublished(section.status);
  const canonicalUnreleased = isNegativelyPublished(section.status);
  if (!canonicalPublished && !canonicalUnreleased) continue;
  const windows = findVersionMentionWindows(allDocumentsText, version, 220);
  for (const windowText of windows) {
    if (canonicalPublished && isNegativelyPublished(windowText)) {
      fail("documentation", `v${version} release state`, "published", "described as unreleased/unpublished", `mark v${version} published (matches docs/ROADMAP.md), or update docs/ROADMAP.md if this is inaccurate`);
      break;
    }
    if (canonicalUnreleased && isPositivelyPublished(windowText)) {
      fail("documentation", `v${version} release state`, "unreleased/not yet published (matches docs/ROADMAP.md)", "described as published", `mark v${version} unreleased/not yet published, or update docs/ROADMAP.md if it has actually been published`);
      break;
    }
  }
}

if (/automated (security )?validation (is|counts as|provides) (a )?manual pentest/i.test(allDocumentsText)) fail("documentation", "automated/manual boundary", "the agreed planning boundary", "contradictory wording", "describe automated validation and manual pentest as distinct workflows");

if (failures.length) { console.error("Documentation consistency check failed:"); for (const failure of failures) console.error(`- ${failure}`); process.exitCode = 1; }
else console.log(`Documentation consistency check passed (${Object.keys(manifest.documents).length} manifested documents, ${requiredVersions.length} preserved roadmap versions).`);

function escape(value) { return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
