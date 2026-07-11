import fs from "node:fs";
import path from "node:path";

const root = process.env.DOCS_CHECK_ROOT ? path.resolve(process.env.DOCS_CHECK_ROOT) : process.cwd();
const files = ["README.md", "CHANGELOG.md", "docs/PROJECT_OVERVIEW.md", "docs/ARCHITECTURE.md", "docs/COMMANDS.md", "docs/WORKFLOWS.md", "docs/ROADMAP.md", "docs/CURRENT_STATE.md", "docs/security-validation-framework.md"];
const gradle = ["wrapper-version", "tasks", "assemble-debug", "unit-test-debug", "lint-debug"];
const tools = ["semgrep", "osv", "android-lint", "dependency-check"];
const network = ["deny", "allow-requested"];
const failures = [];
const docs = new Map(files.map((file) => [file, fs.existsSync(path.join(root, file)) ? fs.readFileSync(path.join(root, file), "utf8") : ""]));
const all = [...docs.values()].join("\n");
const requireIn = (file, value) => { if (!docs.get(file)?.includes(value)) failures.push(`${file}: missing invariant: ${value}`); };

for (const file of files) if (!docs.get(file)) failures.push(`${file}: required document is missing or empty`);
for (const value of ["v0.4.0", "published", "v0.4.1", "unreleased", "nineteen", "CandidateEvidence", "zero Gradle", "zero external"] ) requireIn("README.md", value);
for (const flag of ["--android-gradle-operations", "--android-external-tools", "--android-external-network"]) { requireIn("README.md", flag); requireIn("docs/COMMANDS.md", flag); }
for (const value of gradle) requireIn("docs/COMMANDS.md", `\`${value}\``);
for (const value of tools) requireIn("docs/COMMANDS.md", `\`${value}\``);
for (const value of network) requireIn("docs/COMMANDS.md", `\`${value}\``);
requireIn("docs/ROADMAP.md", "### v0.4.2"); requireIn("docs/ROADMAP.md", "Future");

const forbidden = [
  [/v0\.4\.0[^\n]*(publication pending|not published)/i, "claims v0.4.0 publication is pending"],
  [/v0\.4\.1[^\n]*(is published|released v0\.4\.1|publish-ready)/i, "claims v0.4.1 is released or publish-ready"],
  [/v0\.4\.1[^\n]*(planned advanced|advanced Android checks remain planned)/i, "describes completed v0.4.1 work as planned"],
  [/placeholders and Android resources are not resolved/i, "uses the obsolete absolute resource-resolution limitation"],
  [/AuditIssue mapping is implemented/i, "claims v0.4.2 AuditIssue mapping is current"],
  [/runtime (security )?(validated|guaranteed)|APK\/AAB (validation|inspection) is implemented/i, "claims runtime or APK/AAB validation"],
  [/real external-tool compatibility (is|was|has been) verified/i, "claims real external-tool compatibility"],
];
for (const [pattern, message] of forbidden) if (pattern.test(all)) failures.push(`documentation: ${message}`);

const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
if (pkg.version !== "0.4.0") failures.push(`package.json: expected implementation-stage version 0.4.0, found ${pkg.version}`);
if (failures.length) { console.error("Documentation consistency check failed:"); for (const failure of failures) console.error(`- ${failure}`); process.exitCode = 1; }
else console.log(`Documentation consistency check passed (${files.length} documents, ${gradle.length} Gradle IDs, ${tools.length} tool IDs, ${network.length} network policies).`);
