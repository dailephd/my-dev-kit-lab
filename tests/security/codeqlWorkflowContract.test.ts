import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const workflowPath = resolve(process.cwd(), ".github/workflows/codeql.yml");
const configPath = resolve(process.cwd(), ".github/codeql/codeql-config.yml");

function readWorkflow(): string {
  return readFileSync(workflowPath, "utf8");
}

function getEventBlock(workflow: string, event: string): string {
  const match = workflow.match(
    new RegExp(`^  ${event}:\\s*$([\\s\\S]*?)(?=^  [a-z_]+:|^permissions:)`, "m"),
  );
  return match?.[1] ?? "";
}

describe("GitHub CodeQL advanced setup contract", () => {
  it("runs on main and validation-family pushes, main pull requests, and manual dispatch", () => {
    const workflow = readWorkflow();
    expect(workflow).toContain("name: CodeQL");

    const push = getEventBlock(workflow, "push");
    for (const branch of ["main", '"feature/**"', '"fix/**"', '"release/**"', '"validation/**"']) {
      expect(push).toContain(`- ${branch}`);
    }

    expect(getEventBlock(workflow, "pull_request")).toContain("- main");
    expect(workflow).toMatch(/^  workflow_dispatch:\s*$/m);
  });

  it("uses least-privilege permissions and separate required language analyses", () => {
    const workflow = readWorkflow();
    expect(workflow).toMatch(/^      contents: read$/m);
    expect(workflow).toMatch(/^      security-events: write$/m);
    expect(workflow).toMatch(/^      actions: read$/m);
    expect(workflow).not.toMatch(/^\s+(?:contents|packages|pull-requests): write$/m);
    const writePermissions = [...workflow.matchAll(/^\s+([\w-]+): write$/gm)].map((match) => match[1]);
    expect(writePermissions).toEqual(["security-events"]);
    expect(workflow).toContain("- javascript-typescript");
    expect(workflow).toContain("- actions");
    expect(workflow).toContain("runs-on: ubuntu-latest");
    expect(workflow).toContain("actions/checkout@v7");
    expect(workflow).toContain("github/codeql-action/init@v4");
    expect(workflow).toContain("github/codeql-action/analyze@v4");
    expect(workflow).toContain("build-mode: none");
    expect(workflow).toContain("category: /language:${{ matrix.language }}");
    expect(workflow).toContain("config-file: ./.github/codeql/codeql-config.yml");
    expect(workflow).not.toMatch(/^\s*continue-on-error:\s*true\s*$/m);
    expect(readFileSync(configPath, "utf8")).toBeTruthy();
  });
});

describe("CodeQL configuration boundaries", () => {
  it("excludes generated, dependency, test, and benchmark fixtures without excluding production paths", () => {
    const config = readFileSync(configPath, "utf8");
    const ignoredPaths = [...config.matchAll(/^  - (.+)$/gm)].map((match) => match[1]);

    expect(ignoredPaths).toEqual(["dist/**", "node_modules/**", "tests/**", "benchmarks/**"]);
    expect(ignoredPaths).not.toContain("src/**");
    expect(ignoredPaths).not.toContain("scripts/**");
    expect(ignoredPaths).not.toContain(".github/workflows/**");
    expect(config).toContain("benchmark applications");
  });
});
