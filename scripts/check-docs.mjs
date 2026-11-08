import fs from "node:fs";
import path from "node:path";

const root = path.resolve(process.env.DOCS_CHECK_ROOT || process.cwd());
const manifestFile = "docs/documentation-preservation-manifest.json";
const failures = [];
const read = (file) => {
  const target = path.join(root, file);
  return fs.existsSync(target) ? fs.readFileSync(target, "utf8") : "";
};
const fail = (file, rule, expected, actual, correction) => failures.push(
  `${file}: ${rule}; expected ${expected}; actual ${actual}; suggested correction: ${correction}`,
);
const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const normalize = (value) => value.toLowerCase().replace(/[`*_]/g, "").replace(/[^a-z0-9.:-]+/g, " ").trim();

if (!read(manifestFile)) {
  fail(manifestFile, "preservation manifest", "a readable tracked manifest", "missing", "restore the manifest");
}

let manifest = {};
try {
  manifest = JSON.parse(read(manifestFile) || "{}");
} catch (error) {
  fail(manifestFile, "JSON syntax", "valid JSON", error.message, "repair the manifest JSON");
}

for (const file of manifest.requiredDocuments || []) {
  if (!read(file).trim()) fail(file, "required document", "present and non-empty", "missing or empty", "restore the canonical document");
}

for (const [file, rules] of Object.entries(manifest.documents || {})) {
  const body = read(file);
  if (!body) continue;
  const headings = [...body.matchAll(/^#{1,6}\s+(.+)$/gm)].map((match) => normalize(match[1]));
  for (const required of rules.requiredHeadings || []) {
    if (!headings.some((heading) => heading.includes(normalize(required)))) {
      fail(file, `required heading "${required}"`, "present", "missing", `restore the ${required} section with its canonical-role content`);
    }
  }
  for (const topic of rules.requiredTopics || []) {
    if (!normalize(body).includes(normalize(topic))) {
      fail(file, `preserved topic "${topic}"`, "present", "missing", `restore coverage of ${topic} without weakening the manifest`);
    }
  }
}

const roadmap = read("docs/ROADMAP.md");
const roadmapMatches = [...roadmap.matchAll(/^###\s+(v\d+\.\d+\.\d+)\b([^\n]*)$/gm)];
const actualVersions = roadmapMatches.map((match) => match[1]);
const requiredVersions = manifest.roadmap?.requiredVersions || [];
for (const version of requiredVersions) {
  const count = actualVersions.filter((actual) => actual === version).length;
  if (count !== 1) fail("docs/ROADMAP.md", `roadmap version ${version}`, "exactly one individual ### section", `${count} sections`, `restore one separate ${version} section`);
}
let priorIndex = -1;
for (const version of requiredVersions) {
  const index = actualVersions.indexOf(version);
  if (index >= 0 && index <= priorIndex) fail("docs/ROADMAP.md", `semantic order at ${version}`, "after the preceding required version", `position ${index}`, "restore semantic version order without ranges");
  if (index >= 0) priorIndex = index;
}
for (const range of manifest.roadmap?.forbiddenVersionRangeHeadings || []) {
  if (new RegExp(`^###\\s+.*${escapeRegex(range)}`, "mi").test(roadmap)) {
    fail("docs/ROADMAP.md", `version-range substitution "${range}"`, "absent from version headings", "present", "restore each individual version section");
  }
}
for (const heading of manifest.roadmap?.requiredHeadings || []) {
  if (!new RegExp(`^##\\s+.*${escapeRegex(heading)}`, "mi").test(roadmap)) fail("docs/ROADMAP.md", `required section "${heading}"`, "present", "missing", `restore the ${heading} section`);
}
for (const label of manifest.roadmap?.requiredContentLabels || []) {
  if (!roadmap.includes(label)) fail("docs/ROADMAP.md", `required roadmap content "${label}"`, "present", "missing", `restore ${label} content to the affected version plans`);
}
for (const marker of manifest.roadmap?.requiredDeferredMarkers || []) {
  if (!normalize(roadmap).includes(normalize(marker))) fail("docs/ROADMAP.md", `deferred marker "${marker}"`, "present", "missing", "restore the deferred plan without assigning an unsupported version");
}

function roadmapSections() {
  const sections = new Map();
  roadmapMatches.forEach((match) => {
    const start = match.index;
    const afterHeading = start + match[0].length;
    const nextHeadingOffset = roadmap.slice(afterHeading).search(/^###\s+/m);
    const end = nextHeadingOffset >= 0 ? afterHeading + nextHeadingOffset : roadmap.length;
    const body = roadmap.slice(start, end);
    const status = body.match(/^Status:\s*(.+)$/mi)?.[1]?.trim() || match[2].trim();
    sections.set(match[1].slice(1), { body, status });
  });
  return sections;
}
const sections = roadmapSections();
const negatedPublication = /\b(?:(?:not|never)\s+(?:yet\s+)?(?:(?:been|be)\s+)?(?:published|released)|(?:isn't|wasn't|weren't|hasn't|hadn't|won't)\s+(?:yet\s+)?(?:(?:been|be)\s+)?published|unpublished|unreleased(?!\s+v\d)|publication\s+(?:is\s+)?pending|pending\s+publication)\b/i;
const positivePublication = (text) => /\bpublished\b/i.test(
  (text || "").replace(new RegExp(negatedPublication.source, "gi"), ""),
);
const transitionalReleaseWording = /\b(?:not\s+(?:yet\s+)?released|unreleased|unpublished|(?:still\s+)?in\s+(?:release\s+)?preparation|release\s+preparation\s+(?:is\s+)?(?:pending|ongoing|in\s+progress)|awaiting\s+(?:release\s+)?(?:validation|readiness)|pre[- ]release\s+readiness\s+(?:is\s+)?pending|pending\s+publication|publication\s+(?:is\s+)?pending)\b/i;

// Bind a claim to an exact version mention, not to a nearby version elsewhere
// on the Markdown line. Semicolons/commas may continue the last explicit subject;
// a new sentence or version starts a separate claim. Link destinations are not prose.
function versionClaims(body) {
  const claims = [];
  for (const line of body.split(/\r?\n/)) {
    const visible = line.replace(/!?\[([^\]]*)\]\([^)]+\)/g, "$1");
    for (const sentence of visible.split(/(?<=[.!?])\s+/)) {
      let subject = "";
      for (const clause of sentence.split(/[;,]/)) {
        const mentions = [...clause.matchAll(/\bv?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)\b/g)];
        if (!mentions.length) {
          if (subject) claims.push({ version: subject, window: clause });
          continue;
        }
        mentions.forEach((mention, index) => {
          const prefix = clause.slice(0, mention.index);
          const publicationPrefix = /\b(?:(?:not|never)\s+(?:yet\s+)?(?:(?:been|be)\s+)?)?(?:published|unpublished|unreleased|pending\s+publication|publication\s+(?:is\s+)?pending)\s*(?:for\s*)?:?\s*$/i.exec(prefix);
          const start = index === 0 && publicationPrefix ? publicationPrefix.index : mention.index;
          const end = mentions[index + 1]?.index ?? clause.length;
          claims.push({ version: mention[1], window: clause.slice(start, end) });
        });
        subject = mentions[mentions.length - 1][1];
      }
    }
  }
  return claims;
}
const plannedLifecycle = /\b(?:planned|future|deferred|not implemented|not started|pre-release readiness pending)\b/i;
// Implemented-but-unreleased: code exists in the checkout, publication has not happened.
const implementedUnreleasedLifecycle = (text) =>
  /\bimplemented\b/i.test(text || "") && !/\bnot\s+(?:yet\s+)?implemented\b/i.test(text || "") && /\bunreleased\b/i.test(text || "");
for (const version of requiredVersions) {
  const count = [...(sections.get(version.slice(1))?.body || "").matchAll(/^Status:/gmi)].length;
  if (count !== 1) fail("docs/ROADMAP.md", `${version} lifecycle status`, "exactly one explicit Status: line", `${count} lines`, `retain one concise Status line in ${version}`);
}

const packageJson = JSON.parse(read("package.json") || "{}");
const packageVersion = String(packageJson.version || "");
if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(packageVersion)) {
  fail("package.json", "package version", "valid semantic version", packageVersion || "missing", "set a valid semantic version");
} else if (!sections.has(packageVersion)) {
  fail("docs/ROADMAP.md", `package version v${packageVersion}`, "matching roadmap section", "missing", `add the v${packageVersion} section`);
}

const latestPublished = String(manifest.currentFacts?.latestPublishedVersion || "");
const finalReleaseDocumentState = manifest.currentFacts?.releaseDocumentState === "final-release-state";
const currentReleaseDocumentVersion = String(manifest.currentFacts?.currentReleaseDocumentVersion || "");
// Published history and prepared release documents have independent owners.
if (latestPublished) {
  const status = sections.get(latestPublished)?.status || "";
  if (!positivePublication(status)) {
    const label = packageVersion === latestPublished ? "current package" : "published baseline";
    fail("docs/ROADMAP.md", label + " v" + latestPublished + " lifecycle",
      "positively published", status || "missing", "retain the verified published baseline's status");
  }
}
if (finalReleaseDocumentState) {
  if (!currentReleaseDocumentVersion || packageVersion !== currentReleaseDocumentVersion
      || currentReleaseDocumentVersion === latestPublished) {
    fail(manifestFile, "prepared release-document identity",
      "package version matches a release-document version distinct from the published baseline",
      currentReleaseDocumentVersion || "missing", "record published and prepared versions separately");
  }
  const status = sections.get(currentReleaseDocumentVersion)?.status || "";
  if (!/(?:release candidate prepared|final release-document state)/i.test(status) || positivePublication(status)) {
    fail("docs/ROADMAP.md", "current release-document v" + currentReleaseDocumentVersion + " lifecycle",
      "final release-document wording without a publication claim", status || "missing",
      "mark the prepared release-document state and keep external publication evidence distinct");
  }
}
const nextPlanned = String(manifest.currentFacts?.nextPlannedVersion || "");
if (nextPlanned) {
  const status = sections.get(nextPlanned)?.status || "";
  if (!sections.has(nextPlanned)) fail("docs/ROADMAP.md", `next planned v${nextPlanned}`, "individual section", "missing", "restore the approved next version");
  else if (positivePublication(status) || !plannedLifecycle.test(status) || implementedUnreleasedLifecycle(status)) fail("docs/ROADMAP.md", `next planned v${nextPlanned} lifecycle`, "planned/unreleased and not positively published", status || "missing", "mark it planned and not implemented");
}
const implementedUnreleased = String(manifest.currentFacts?.currentImplementedUnreleasedVersion || "");
if (implementedUnreleased) {
  const status = sections.get(implementedUnreleased)?.status || "";
  if (implementedUnreleased === latestPublished || implementedUnreleased === nextPlanned) {
    fail(manifestFile, "current implemented unreleased version", "distinct from the latest published and next planned versions", implementedUnreleased, "record published, implemented/unreleased, and planned versions separately");
  }
  if (!sections.has(implementedUnreleased)) fail("docs/ROADMAP.md", `implemented unreleased v${implementedUnreleased}`, "individual section", "missing", "restore the implemented version section");
  else if (positivePublication(status) || !implementedUnreleasedLifecycle(status)) fail("docs/ROADMAP.md", `implemented unreleased v${implementedUnreleased} lifecycle`, "implemented and unreleased, not positively published", status || "missing", "mark it implemented; unreleased; pre-release readiness pending");
}
for (const pluginId of manifest.currentFacts?.implementedExperimentPlugins || []) {
  for (const file of manifest.currentFacts?.experimentPluginDocuments || []) {
    if (!read(file).includes(pluginId)) fail(file, `implemented experiment plugin ${pluginId}`, "documented", "missing", `restore documentation of the implemented ${pluginId} plugin`);
  }
}

const changelog = read("CHANGELOG.md");
for (const version of manifest.changelog?.requiredPublishedReleases || []) {
  if (!new RegExp(`^##\\s+\\[?v?${escapeRegex(version)}(?:\\]|\\s|$)`, "mi").test(changelog)) {
    fail("CHANGELOG.md", `published release ${version}`, "release heading retained", "missing", `restore the ${version} release entry from verified history`);
  }
}

const currentDocs = ["README.md", "docs/PROJECT_OVERVIEW.md", "docs/CURRENT_STATE.md", "docs/COMMANDS.md", "docs/WORKFLOWS.md", "docs/ARCHITECTURE.md", "docs/security-validation-framework.md"]
  .map((file) => ({ file, body: read(file) }));
const staleRules = [
  [/v0\.4\.1[^\n]{0,100}(?:current published|published baseline)|current published[^\n]{0,100}v0\.4\.1/i, "latest published version", "v0.4.2", "replace stale v0.4.1-current wording with v0.4.2"],
  [/0\.4\.2[^\n]{0,100}(?:release-prepared|not yet published|publication[^\n]{0,30}(?:remain|pending))|publication[^\n]{0,80}(?:remain|pending)[^\n]{0,80}0\.4\.2/i, "v0.4.2 publication state", "published", "remove stale release-preparation wording"],
  [/Android[^\n]{0,80}(?:not implemented|remains planned|profiles? (?:is|are) planned)/i, "Android implementation state", "implemented and published", "describe only additional mobile profiles as planned"],
  [/\bthe only currently published way\b/i, "current installed-package workflow", "the published installed CLI and contributor workflow described separately", "remove stale wording that treats source checkout as the only published command path"],
];
for (const { file, body } of currentDocs) for (const [pattern, rule, expected, correction] of staleRules) {
  const match = body.match(pattern);
  if (match) fail(file, rule, expected, match[0].trim(), correction);
}
const workflows = read("docs/WORKFLOWS.md");
if (!/npm publish --access public` must be the final state-changing command/i.test(workflows)) {
  fail("docs/WORKFLOWS.md", "publication-order invariant", "npm publish --access public is the final state-changing command", "missing", "restore the final-publication-command invariant");
}
if (!/release documentation[\s\S]{0,500}final post-publication state[\s\S]{0,500}before/i.test(workflows)) {
  fail("docs/WORKFLOWS.md", "release-documentation final-state invariant", "release docs reach final post-publication state before merge/tag/GitHub Release/package publication", "missing", "require final release documentation before publication-side state changes");
}
if (/If docs need to be updated to reflect the now-published state/i.test(workflows)) {
  fail("docs/WORKFLOWS.md", "planned post-publication documentation repair", "absent", "present", "require release documentation to be final before npm publish; handle later-discovered defects as a separate correction workflow");
}

const lifecycleRoles = new Map([
  [latestPublished, "published"],
  [implementedUnreleased, "implemented-unreleased"],
  [nextPlanned, "planned"],
  ...(finalReleaseDocumentState ? [[currentReleaseDocumentVersion, "prepared"]] : []),
]);
for (const { file, body } of currentDocs) {
  for (const { version, window } of versionClaims(body)) {
    const kind = lifecycleRoles.get(version);
    if (!version || !kind) continue;
    const marker = "v" + version;
    if (kind === "published" && negatedPublication.test(window)) {
      fail(file, marker + " publication claim", "published or release-neutral", window.trim(),
        "retain the verified publication fact; do not describe the published version as unpublished");
    }
    if (kind === "published" && /\bpending\b/i.test(window)) {
      fail(file, marker + " lifecycle wording", "published/current or accurate historical wording", window.trim(),
        "remove stale pending-state language for " + marker);
    }
    if (kind === "prepared" && positivePublication(window)) {
      fail(file, marker + " publication claim", "final release-document wording without a publication claim",
        window.trim(), "do not infer publication from release-preparation metadata");
    }
    if (kind === "prepared" && (negatedPublication.test(window) || transitionalReleaseWording.test(window))) {
      fail(file, marker + " final release-document wording", "final and publication-neutral", window.trim(),
        "remove transitional wording that becomes stale after publication");
    }
    if (kind === "planned" && positivePublication(window)) {
      fail(file, marker + " publication claim", "planned/unreleased or release-neutral", window.trim(),
        "do not describe the planned version as published");
    }
    if (kind === "implemented-unreleased" && positivePublication(window)) {
      fail(file, marker + " publication claim", "implemented/unreleased or release-neutral", window.trim(),
        "do not describe the unreleased version as published");
    }
    if (kind === "implemented-unreleased" && /\bnot\s+(?:yet\s+)?implemented\b|\bnext planned\b/i.test(window)) {
      fail(file, marker + " implementation claim", "implemented", window.trim(),
        "describe the implemented version as implemented and unreleased");
    }
  }
}
for (const [pattern, description] of [
  [/^Current branch:\s+/mi, "current branch bookkeeping"],
  [/^Current commit:\s+[0-9a-f]{7,40}\b/mi, "current commit bookkeeping"],
  [/^CI run(?: id| number)?:\s*#?\d+/mi, "current CI-run bookkeeping"],
]) {
  const match = roadmap.match(pattern);
  if (match) fail("docs/ROADMAP.md", description, "absent", match[0].trim(), "move operational state to docs/CURRENT_STATE.md");
}

function unsupportedPositiveLine(file, token) {
  for (const line of read(file).split(/\r?\n/).filter((value) => value.includes(token))) {
    if (!/\b(?:no|not|isn't|is not|does not|unsupported|absent|future|planned|conceptual|candidate)\b/i.test(line)) {
      fail(file, `unsupported current surface ${token}`, "absent or explicitly negated/planned", line.trim(), `remove ${token} from current syntax or label it unsupported/planned`);
    }
  }
}
unsupportedPositiveLine("docs/COMMANDS.md", "android-compose");
unsupportedPositiveLine("docs/COMMANDS.md", "security:pentest");

const allCanonical = (manifest.requiredDocuments || []).map(read).join("\n");
for (const line of allCanonical.split(/\r?\n/)) {
  if (/(?:automated (?:security )?validation|Android validation)\s+(?:is|provides|counts as)\s+(?:a\s+)?manual pentest/i.test(line) && !/\b(?:not|never|isn't|does not)\b/i.test(line)) {
    fail("documentation", "automated/manual-pentest boundary", "distinct workflows", line.trim(), "state that automated validation is not manual pentesting");
    break;
  }
}
if (!/CandidateEvidence[^\n]{0,160}(?:review|not[^\n]{0,40}(?:SecurityFinding|AuditIssue|confirmed))/i.test(allCanonical)) fail("documentation", "CandidateEvidence distinction", "review evidence, not a confirmed finding or AuditIssue", "missing", "restore the evidence/finding boundary");
if (!/security:validate[^\n]{0,180}(?:separate|standalone)[^\n]{0,100}(?:audit|npm run audit)|(?:separate|standalone)[^\n]{0,100}security:validate/i.test(allCanonical)) fail("documentation", "security command separation", "security:validate remains separate from npm run audit", "missing", "restore the standalone-command boundary");
if (!/Android[^\n]{0,160}(?:static|non-destructive)[^\n]{0,160}(?:zero|off by default|opt-in)/i.test(allCanonical)) fail("documentation", "Android default safety boundary", "static/non-destructive with zero-process defaults", "missing", "restore the default process/network/mutation boundary");

for (const script of ["experiment:list", "experiment:describe", "experiment:run", "audit", "security:validate", "docs:check", "verify"]) {
  if (!packageJson.scripts?.[script]) fail("package.json", `implemented script ${script}`, "present", "missing", `restore ${script} or explicitly authorize removal and update all canonical documents`);
}

if (failures.length) {
  console.error("Documentation consistency check failed:");
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exitCode = 1;
} else {
  console.log(`Documentation consistency check passed (${manifest.requiredDocuments?.length || 0} documents, ${requiredVersions.length} roadmap versions, ${manifest.changelog?.requiredPublishedReleases?.length || 0} published releases).`);
}
