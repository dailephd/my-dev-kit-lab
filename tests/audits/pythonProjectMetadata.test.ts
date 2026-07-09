import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { collectPythonProjectMetadata } from "../../src/audits/core/pythonProjectMetadata.js";
import { scanProjectInventory } from "../../src/audits/core/projectInventory.js";

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "python-project-metadata-test-"));
}

function cleanup(...dirs: string[]): void {
  for (const d of dirs) {
    try {
      fs.rmSync(d, { recursive: true, force: true });
    } catch {
      // best-effort
    }
  }
}

function writeFile(root: string, relativePath: string, content = ""): void {
  const fullPath = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, content, "utf8");
}

function collect(root: string) {
  const inventory = scanProjectInventory(root);
  return collectPythonProjectMetadata(root, inventory);
}

describe("collectPythonProjectMetadata — T6 presence detection", () => {
  it("detects presence of recognized Python metadata/config files", () => {
    const root = makeTempDir();
    try {
      writeFile(root, "pyproject.toml", "[project]\nname = \"fixture\"\n");
      writeFile(root, "requirements.txt", "requests==2.0.0\n");
      writeFile(root, "setup.cfg", "[metadata]\nname = fixture-cfg\n");
      writeFile(root, "pytest.ini", "[pytest]\n");
      const metadata = collect(root);
      expect(metadata.hasPyprojectToml).toBe(true);
      expect(metadata.hasRequirementsTxt).toBe(true);
      expect(metadata.hasSetupCfg).toBe(true);
      expect(metadata.hasPytestIni).toBe(true);
      expect(metadata.hasSetupPy).toBe(false);
      expect(metadata.hasToxIni).toBe(false);
    } finally {
      cleanup(root);
    }
  });

  it("reports every file absent for a project with no Python metadata files", () => {
    const root = makeTempDir();
    try {
      writeFile(root, "README.md", "# Fixture\n");
      const metadata = collect(root);
      expect(metadata.hasPyprojectToml).toBe(false);
      expect(metadata.hasRequirementsTxt).toBe(false);
      expect(metadata.hasSetupPy).toBe(false);
      expect(metadata.hasSetupCfg).toBe(false);
      expect(metadata.hasToxIni).toBe(false);
      expect(metadata.hasPytestIni).toBe(false);
      expect(metadata.hasPytestConfiguration).toBe(false);
      expect(metadata.projectName).toBeNull();
    } finally {
      cleanup(root);
    }
  });

  it("does not run any Python/pip/pytest/tox tooling and does not modify the target project", () => {
    const root = makeTempDir();
    try {
      writeFile(root, "pyproject.toml", "[project]\nname = \"fixture\"\n");
      const before = fs.readFileSync(path.join(root, "pyproject.toml"), "utf8");
      collect(root);
      const after = fs.readFileSync(path.join(root, "pyproject.toml"), "utf8");
      expect(after).toBe(before);
    } finally {
      cleanup(root);
    }
  });
});

describe("collectPythonProjectMetadata — T6 simple project-name extraction", () => {
  it("extracts a simple project name from pyproject.toml", () => {
    const root = makeTempDir();
    try {
      writeFile(root, "pyproject.toml", ["[project]", "name = \"my-fixture-project\"", "version = \"1.0.0\""].join("\n") + "\n");
      const metadata = collect(root);
      expect(metadata.projectName).toBe("my-fixture-project");
    } finally {
      cleanup(root);
    }
  });

  it("extracts a simple project name from setup.cfg's [metadata] section when pyproject.toml is absent", () => {
    const root = makeTempDir();
    try {
      writeFile(root, "setup.cfg", ["[metadata]", "name = my-cfg-project", "", "[options]", "packages = find:"].join("\n") + "\n");
      const metadata = collect(root);
      expect(metadata.projectName).toBe("my-cfg-project");
    } finally {
      cleanup(root);
    }
  });

  it("prefers pyproject.toml's name over setup.cfg's when both are present", () => {
    const root = makeTempDir();
    try {
      writeFile(root, "pyproject.toml", "[project]\nname = \"toml-wins\"\n");
      writeFile(root, "setup.cfg", "[metadata]\nname = cfg-loses\n");
      const metadata = collect(root);
      expect(metadata.projectName).toBe("toml-wins");
    } finally {
      cleanup(root);
    }
  });

  it("does not extract a name from a setup.cfg section other than [metadata]", () => {
    const root = makeTempDir();
    try {
      writeFile(root, "setup.cfg", "[options]\nname = should-not-be-picked-up\n");
      const metadata = collect(root);
      expect(metadata.projectName).toBeNull();
    } finally {
      cleanup(root);
    }
  });
});

describe("collectPythonProjectMetadata — T6 pytest configuration detection", () => {
  it("detects pytest configuration via pyproject.toml's [tool.pytest.ini_options]", () => {
    const root = makeTempDir();
    try {
      writeFile(root, "pyproject.toml", ["[project]", "name = \"fixture\"", "", "[tool.pytest.ini_options]", "minversion = \"6.0\""].join("\n") + "\n");
      const metadata = collect(root);
      expect(metadata.hasPytestConfiguration).toBe(true);
      expect(metadata.hasPytestIni).toBe(false);
    } finally {
      cleanup(root);
    }
  });

  it("detects pytest configuration via setup.cfg's [tool:pytest]", () => {
    const root = makeTempDir();
    try {
      writeFile(root, "setup.cfg", "[tool:pytest]\ntestpaths = tests\n");
      const metadata = collect(root);
      expect(metadata.hasPytestConfiguration).toBe(true);
    } finally {
      cleanup(root);
    }
  });

  it("detects pytest configuration via a standalone pytest.ini", () => {
    const root = makeTempDir();
    try {
      writeFile(root, "pytest.ini", "[pytest]\ntestpaths = tests\n");
      const metadata = collect(root);
      expect(metadata.hasPytestConfiguration).toBe(true);
    } finally {
      cleanup(root);
    }
  });
});
