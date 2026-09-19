import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  executeTutorialAssertion,
  resolveAssertionRequestUrl,
  resolveJsonPointer
} from "../../src/tutorial/tutorialAssertions.js";
import { DEFAULT_TUTORIAL_ASSERTION_TIMEOUT_MS } from "../../src/tutorial/types.js";
import { createFakePage } from "./tutorialTestHelpers.js";

const tempDirs: string[] = [];
const servers: http.Server[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => closeServer(server)));
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function makeTempDir(prefix = "tutorial-assert-"): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function closeServer(server: http.Server): Promise<void> {
  return new Promise((resolve) => {
    server.closeAllConnections?.();
    server.close(() => resolve());
  });
}

async function startLocalServer(handler: http.RequestListener): Promise<string> {
  const server = http.createServer(handler);
  servers.push(server);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
}

const NO_FILES = { applicationUrl: "http://127.0.0.1:1/", targetRoot: path.join(os.tmpdir(), "unused") };

describe("resolveJsonPointer", () => {
  const document = {
    field: "value",
    parent: { child: 7 },
    items: [10, 20],
    "a/b": "slash",
    "a~b": "tilde",
    nested: { deep: { flag: false } },
    nullish: null
  };

  it("returns the whole document for an empty pointer", () => {
    expect(resolveJsonPointer(document, "")).toEqual({ ok: true, value: document });
  });

  it("resolves a top-level field", () => {
    expect(resolveJsonPointer(document, "/field")).toEqual({ ok: true, value: "value" });
  });

  it("resolves a nested field", () => {
    expect(resolveJsonPointer(document, "/parent/child")).toEqual({ ok: true, value: 7 });
    expect(resolveJsonPointer(document, "/nested/deep/flag")).toEqual({ ok: true, value: false });
  });

  it("resolves an array element by index", () => {
    expect(resolveJsonPointer(document, "/items/0")).toEqual({ ok: true, value: 10 });
    expect(resolveJsonPointer(document, "/items/1")).toEqual({ ok: true, value: 20 });
  });

  it("decodes ~1 as a literal slash", () => {
    expect(resolveJsonPointer(document, "/a~1b")).toEqual({ ok: true, value: "slash" });
  });

  it("decodes ~0 as a literal tilde", () => {
    expect(resolveJsonPointer(document, "/a~0b")).toEqual({ ok: true, value: "tilde" });
  });

  it("rejects a malformed escape sequence", () => {
    const result = resolveJsonPointer(document, "/a~2b");
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.error).toContain("Malformed JSON Pointer escape");
  });

  it("rejects a pointer that does not begin with a slash", () => {
    const result = resolveJsonPointer(document, "field");
    expect(result.ok).toBe(false);
  });

  it("reports a missing property", () => {
    const result = resolveJsonPointer(document, "/absent");
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.error).toContain("was not found");
  });

  it("reports a missing array element and a non-numeric index", () => {
    expect(resolveJsonPointer(document, "/items/5").ok).toBe(false);
    expect(resolveJsonPointer(document, "/items/x").ok).toBe(false);
  });

  it("resolves an explicit null value", () => {
    expect(resolveJsonPointer(document, "/nullish")).toEqual({ ok: true, value: null });
  });
});

describe("resolveAssertionRequestUrl", () => {
  it("resolves same-origin paths and rejects anything that leaves the origin", () => {
    expect(resolveAssertionRequestUrl("http://127.0.0.1:3000/", "/api/status")).toBe(
      "http://127.0.0.1:3000/api/status"
    );
    expect(() => resolveAssertionRequestUrl("http://127.0.0.1:3000/", "http://example.com/api")).toThrow(
      /root-relative path/
    );
    expect(() => resolveAssertionRequestUrl("http://127.0.0.1:3000/", "//example.com/api")).toThrow(
      /protocol-relative/
    );
  });
});

describe("executeTutorialAssertion - element-visible", () => {
  it("passes when the element becomes visible", async () => {
    const page = createFakePage({ locators: { "css:.ok": { visible: true } } });
    const result = await executeTutorialAssertion(
      page,
      { type: "element-visible", locator: { kind: "css", selector: ".ok" } },
      NO_FILES
    );
    expect(result.status).toBe("passed");
    expect(page.locators.get("css:.ok")?.calls).toEqual([
      { method: "waitFor", args: [{ state: "visible", timeout: DEFAULT_TUTORIAL_ASSERTION_TIMEOUT_MS }] }
    ]);
  });

  it("fails when the element never becomes visible", async () => {
    const page = createFakePage({ locators: { "css:.gone": { visible: false } } });
    const result = await executeTutorialAssertion(
      page,
      { type: "element-visible", locator: { kind: "css", selector: ".gone" } },
      NO_FILES
    );
    expect(result.status).toBe("failed");
    expect(result.error).toContain("was not visible");
  });
});

describe("executeTutorialAssertion - text", () => {
  it("text-equals passes on exact equality and fails on a mismatch", async () => {
    const page = createFakePage({ locators: { "css:.t": { text: "Dashboard" } } });
    const pass = await executeTutorialAssertion(
      page,
      { type: "text-equals", locator: { kind: "css", selector: ".t" }, expected: "Dashboard" },
      NO_FILES
    );
    expect(pass.status).toBe("passed");

    const fail = await executeTutorialAssertion(
      page,
      { type: "text-equals", locator: { kind: "css", selector: ".t" }, expected: "Dash" },
      NO_FILES
    );
    expect(fail.status).toBe("failed");
    expect(fail.error).toContain('expected exactly "Dash"');
  });

  it("text-contains passes on a substring and fails otherwise", async () => {
    const page = createFakePage({ locators: { "css:.t": { text: "Welcome, Ada" } } });
    const pass = await executeTutorialAssertion(
      page,
      { type: "text-contains", locator: { kind: "css", selector: ".t" }, expected: "Ada" },
      NO_FILES
    );
    expect(pass.status).toBe("passed");

    const fail = await executeTutorialAssertion(
      page,
      { type: "text-contains", locator: { kind: "css", selector: ".t" }, expected: "Grace" },
      NO_FILES
    );
    expect(fail.status).toBe("failed");
    expect(fail.error).toContain("expected it to contain");
  });

  it("fails when the element has no text content", async () => {
    const page = createFakePage({ locators: { "css:.t": { text: null } } });
    const result = await executeTutorialAssertion(
      page,
      { type: "text-equals", locator: { kind: "css", selector: ".t" }, expected: "x" },
      NO_FILES
    );
    expect(result.status).toBe("failed");
    expect(result.error).toContain("has no text content");
  });
});

describe("executeTutorialAssertion - url-path-equals", () => {
  it("passes when the path matches and ignores host and port", async () => {
    const page = createFakePage({ url: "http://127.0.0.1:3000/dashboard" });
    const result = await executeTutorialAssertion(page, { type: "url-path-equals", expected: "/dashboard" }, NO_FILES);
    expect(result.status).toBe("passed");
  });

  it("fails on a path mismatch", async () => {
    const page = createFakePage({ url: "http://127.0.0.1:3000/other" });
    const result = await executeTutorialAssertion(page, { type: "url-path-equals", expected: "/dashboard" }, NO_FILES);
    expect(result.status).toBe("failed");
    expect(result.error).toContain('Page path was "/other"');
  });

  it("compares query and hash only when the expectation includes them", async () => {
    const page = createFakePage({ url: "http://127.0.0.1:3000/a?q=1#top" });
    expect((await executeTutorialAssertion(page, { type: "url-path-equals", expected: "/a" }, NO_FILES)).status).toBe(
      "passed"
    );
    expect(
      (await executeTutorialAssertion(page, { type: "url-path-equals", expected: "/a?q=1" }, NO_FILES)).status
    ).toBe("passed");
    expect(
      (await executeTutorialAssertion(page, { type: "url-path-equals", expected: "/a?q=1#top" }, NO_FILES)).status
    ).toBe("passed");
    expect(
      (await executeTutorialAssertion(page, { type: "url-path-equals", expected: "/a?q=2" }, NO_FILES)).status
    ).toBe("failed");
  });
});

describe("executeTutorialAssertion - attribute-equals", () => {
  it("passes on an exact attribute match", async () => {
    const page = createFakePage({ locators: { "css:.a": { attributes: { "data-state": "ready" } } } });
    const result = await executeTutorialAssertion(
      page,
      { type: "attribute-equals", locator: { kind: "css", selector: ".a" }, name: "data-state", expected: "ready" },
      NO_FILES
    );
    expect(result.status).toBe("passed");
  });

  it("fails when the attribute is missing", async () => {
    const page = createFakePage({ locators: { "css:.a": { attributes: {} } } });
    const result = await executeTutorialAssertion(
      page,
      { type: "attribute-equals", locator: { kind: "css", selector: ".a" }, name: "data-state", expected: "ready" },
      NO_FILES
    );
    expect(result.status).toBe("failed");
    expect(result.error).toContain('has no "data-state" attribute');
  });

  it("fails when the attribute value differs", async () => {
    const page = createFakePage({ locators: { "css:.a": { attributes: { "data-state": "busy" } } } });
    const result = await executeTutorialAssertion(
      page,
      { type: "attribute-equals", locator: { kind: "css", selector: ".a" }, name: "data-state", expected: "ready" },
      NO_FILES
    );
    expect(result.status).toBe("failed");
    expect(result.error).toContain('was "busy"');
  });
});

describe("executeTutorialAssertion - http-json-equals", () => {
  it("passes against a real local server", async () => {
    const applicationUrl = await startLocalServer((_req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, counts: { tasks: 3 } }));
    });
    const page = createFakePage();
    const context = { applicationUrl, targetRoot: NO_FILES.targetRoot };

    expect(
      (
        await executeTutorialAssertion(
          page,
          { type: "http-json-equals", path: "/api/status", pointer: "/ok", expected: true },
          context
        )
      ).status
    ).toBe("passed");
    expect(
      (
        await executeTutorialAssertion(
          page,
          { type: "http-json-equals", path: "/api/status", pointer: "/counts/tasks", expected: 3 },
          context
        )
      ).status
    ).toBe("passed");
  });

  it("fails on a non-2xx response", async () => {
    const applicationUrl = await startLocalServer((_req, res) => {
      res.writeHead(500);
      res.end("boom");
    });
    const result = await executeTutorialAssertion(
      createFakePage(),
      { type: "http-json-equals", path: "/api/status", pointer: "/ok", expected: true },
      { applicationUrl, targetRoot: NO_FILES.targetRoot }
    );
    expect(result.status).toBe("failed");
    expect(result.error).toContain("returned status 500");
  });

  it("fails on invalid JSON", async () => {
    const applicationUrl = await startLocalServer((_req, res) => {
      res.writeHead(200);
      res.end("not json");
    });
    const result = await executeTutorialAssertion(
      createFakePage(),
      { type: "http-json-equals", path: "/api/status", pointer: "/ok", expected: true },
      { applicationUrl, targetRoot: NO_FILES.targetRoot }
    );
    expect(result.status).toBe("failed");
    expect(result.error).toContain("is not valid JSON");
  });

  it("fails on a missing JSON Pointer and on a scalar mismatch", async () => {
    const applicationUrl = await startLocalServer((_req, res) => {
      res.writeHead(200);
      res.end(JSON.stringify({ ok: false }));
    });
    const context = { applicationUrl, targetRoot: NO_FILES.targetRoot };

    const missing = await executeTutorialAssertion(
      createFakePage(),
      { type: "http-json-equals", path: "/api/status", pointer: "/absent", expected: true },
      context
    );
    expect(missing.status).toBe("failed");
    expect(missing.error).toContain("did not resolve");

    const mismatch = await executeTutorialAssertion(
      createFakePage(),
      { type: "http-json-equals", path: "/api/status", pointer: "/ok", expected: true },
      context
    );
    expect(mismatch.status).toBe("failed");
    expect(mismatch.error).toContain("was false, expected true");
  });

  it("rejects a cross-origin request without contacting anything", async () => {
    const result = await executeTutorialAssertion(
      createFakePage(),
      { type: "http-json-equals", path: "http://example.com/api" as string, pointer: "/ok", expected: true },
      { applicationUrl: "http://127.0.0.1:3000/", targetRoot: NO_FILES.targetRoot }
    );
    expect(result.status).toBe("failed");
    expect(result.error).toContain("root-relative path");
  });
});

describe("executeTutorialAssertion - json-file-equals", () => {
  it("passes when the pointer resolves to the expected scalar", async () => {
    const targetRoot = makeTempDir();
    mkdirSync(path.join(targetRoot, "out"), { recursive: true });
    writeFileSync(path.join(targetRoot, "out", "report.json"), JSON.stringify({ counts: { tasks: 3 } }), "utf8");

    const result = await executeTutorialAssertion(
      createFakePage(),
      { type: "json-file-equals", path: "out/report.json", pointer: "/counts/tasks", expected: 3 },
      { applicationUrl: "http://127.0.0.1:1/", targetRoot }
    );
    expect(result.status).toBe("passed");
  });

  it("fails on invalid JSON, a missing pointer and a scalar mismatch", async () => {
    const targetRoot = makeTempDir();
    writeFileSync(path.join(targetRoot, "bad.json"), "not json", "utf8");
    writeFileSync(path.join(targetRoot, "good.json"), JSON.stringify({ n: 1 }), "utf8");
    const context = { applicationUrl: "http://127.0.0.1:1/", targetRoot };

    const invalid = await executeTutorialAssertion(
      createFakePage(),
      { type: "json-file-equals", path: "bad.json", pointer: "/n", expected: 1 },
      context
    );
    expect(invalid.status).toBe("failed");
    expect(invalid.error).toContain("is not valid JSON");

    const missing = await executeTutorialAssertion(
      createFakePage(),
      { type: "json-file-equals", path: "good.json", pointer: "/absent", expected: 1 },
      context
    );
    expect(missing.status).toBe("failed");
    expect(missing.error).toContain("did not resolve");

    const mismatch = await executeTutorialAssertion(
      createFakePage(),
      { type: "json-file-equals", path: "good.json", pointer: "/n", expected: 2 },
      context
    );
    expect(mismatch.status).toBe("failed");
    expect(mismatch.error).toContain("was 1, expected 2");
  });

  it("rejects traversal outside targetRoot", async () => {
    const targetRoot = makeTempDir();
    const result = await executeTutorialAssertion(
      createFakePage(),
      { type: "json-file-equals", path: "../secret.json", pointer: "/n", expected: 1 },
      { applicationUrl: "http://127.0.0.1:1/", targetRoot }
    );
    expect(result.status).toBe("failed");
    expect(result.error).toContain("escapes targetRoot");
  });
});

describe("executeTutorialAssertion - file-exists", () => {
  it("passes for an existing regular file", async () => {
    const targetRoot = makeTempDir();
    writeFileSync(path.join(targetRoot, "report.json"), "{}", "utf8");
    const result = await executeTutorialAssertion(
      createFakePage(),
      { type: "file-exists", path: "report.json" },
      { applicationUrl: "http://127.0.0.1:1/", targetRoot }
    );
    expect(result.status).toBe("passed");
  });

  it("fails for a missing file", async () => {
    const targetRoot = makeTempDir();
    const result = await executeTutorialAssertion(
      createFakePage(),
      { type: "file-exists", path: "missing.json" },
      { applicationUrl: "http://127.0.0.1:1/", targetRoot }
    );
    expect(result.status).toBe("failed");
    expect(result.error).toContain("to exist beneath the tutorial target root");
  });

  it("is not satisfied by a directory", async () => {
    const targetRoot = makeTempDir();
    mkdirSync(path.join(targetRoot, "out"), { recursive: true });
    const result = await executeTutorialAssertion(
      createFakePage(),
      { type: "file-exists", path: "out" },
      { applicationUrl: "http://127.0.0.1:1/", targetRoot }
    );
    expect(result.status).toBe("failed");
    expect(result.error).toContain("is a directory");
  });

  it("rejects traversal outside targetRoot", async () => {
    const targetRoot = makeTempDir();
    const result = await executeTutorialAssertion(
      createFakePage(),
      { type: "file-exists", path: "../../etc/hosts" },
      { applicationUrl: "http://127.0.0.1:1/", targetRoot }
    );
    expect(result.status).toBe("failed");
    expect(result.error).toContain("escapes targetRoot");
  });
});
