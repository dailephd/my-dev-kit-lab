import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const requiredDocs = [
  "README.md",
  "docs/PROJECT_OVERVIEW.md",
  "docs/ARCHITECTURE.md",
  "docs/COMMANDS.md",
  "docs/WORKFLOWS.md",
  "docs/ROADMAP.md",
  "docs/CURRENT_STATE.md",
  "docs/security-validation-framework.md",
];
const androidOperations = ["wrapper-version", "tasks", "assemble-debug", "unit-test-debug", "lint-debug"];
const failures = [];

function read(relativePath) {
  const absolutePath = path.join(root, relativePath);
  if (!fs.existsSync(absolutePath)) {
    failures.push(`${relativePath}: required document is missing`);
    return "";
  }
  return fs.readFileSync(absolutePath, "utf8");
}

function requireText(relativePath, text, invariant) {
  if (!text.includes(invariant)) {
    failures.push(`${relativePath}: missing documentation invariant: ${invariant}`);
  }
}

const docs = new Map(requiredDocs.map((file) => [file, read(file)]));
const readme = docs.get("README.md");
const commands = docs.get("docs/COMMANDS.md");
const roadmap = docs.get("docs/ROADMAP.md");
const currentState = docs.get("docs/CURRENT_STATE.md");

requireText("README.md", readme, "--profile android");
requireText("README.md", readme, "--android-gradle-operations");
requireText("README.md", readme, "reports/security/");
requireText("docs/COMMANDS.md", commands, "npm run security:validate -- --target \"<android-project-path>\" --profile android");
requireText("docs/COMMANDS.md", commands, "zero Gradle processes");
requireText("docs/ROADMAP.md", roadmap, "release-prepared; publication pending");
requireText("docs/ROADMAP.md", roadmap, "### v0.4.1");
requireText("docs/ROADMAP.md", roadmap, "### v0.4.2");
requireText("docs/CURRENT_STATE.md", currentState, "not published");

for (const operation of androidOperations) {
  requireText("README.md", readme, `\`${operation}\``);
  requireText("docs/COMMANDS.md", commands, `\`${operation}\``);
}

for (const [file, content] of docs) {
  if (/android-compose|android-app|--profile mobile/i.test(content)) {
    failures.push(`${file}: contains an unsupported Android profile alias`);
  }
  if (/Gradle (runs|execution) by default/i.test(content)) {
    failures.push(`${file}: claims Gradle execution is enabled by default`);
  }
  if (/Google Play (compliance|policy) (is |has been )?(validated|checked)/i.test(content)) {
    failures.push(`${file}: claims live Google Play validation`);
  }
}

requireText("docs/ROADMAP.md", roadmap, "Manual pentest is not assigned to v0.4.0, v0.4.1, or v0.4.2.");
if (/v0\.4\.0[^\n]*(?:is |was |has been )(?:published|released|available on npm)/i.test(`${readme}\n${currentState}\n${roadmap}`)) {
  failures.push("current documentation claims v0.4.0 is published");
}

if (failures.length > 0) {
  console.error("Documentation consistency check failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log(`Documentation consistency check passed (${requiredDocs.length} documents, ${androidOperations.length} Android Gradle operation IDs).`);
}
