import { describe, expect, it } from "vitest";
import { describeTutorialLocator, resolveTutorialLocator } from "../../src/tutorial/tutorialLocators.js";
import { executeTutorialAction } from "../../src/tutorial/tutorialActions.js";
import { executeTutorialAssertion } from "../../src/tutorial/tutorialAssertions.js";
import { createFakePage } from "./tutorialTestHelpers.js";

describe("resolveTutorialLocator", () => {
  it("maps a role locator onto getByRole and forwards name and exact", () => {
    const page = createFakePage();
    resolveTutorialLocator(page, { kind: "role", role: "button", name: "Save", exact: true });

    expect(page.calls).toEqual([
      { method: "getByRole", args: ["button", { name: "Save", exact: true }] }
    ]);
  });

  it("omits name and exact from getByRole when they are not declared", () => {
    const page = createFakePage();
    resolveTutorialLocator(page, { kind: "role", role: "heading" });

    expect(page.calls).toEqual([{ method: "getByRole", args: ["heading", {}] }]);
  });

  it("maps a text locator onto getByText and forwards exact", () => {
    const page = createFakePage();
    resolveTutorialLocator(page, { kind: "text", text: "Dashboard", exact: false });
    resolveTutorialLocator(page, { kind: "text", text: "Other" });

    expect(page.calls).toEqual([
      { method: "getByText", args: ["Dashboard", { exact: false }] },
      { method: "getByText", args: ["Other", undefined] }
    ]);
  });

  it("maps a css locator onto locator()", () => {
    const page = createFakePage();
    resolveTutorialLocator(page, { kind: "css", selector: "#main .row" });

    expect(page.calls).toEqual([{ method: "locator", args: ["#main .row"] }]);
  });

  it("maps a test-id locator onto getByTestId()", () => {
    const page = createFakePage();
    resolveTutorialLocator(page, { kind: "test-id", testId: "save-button" });

    expect(page.calls).toEqual([{ method: "getByTestId", args: ["save-button"] }]);
  });

  it("describes each locator kind for failure messages", () => {
    expect(describeTutorialLocator({ kind: "role", role: "button", name: "Save" })).toBe(
      'role=button name="Save"'
    );
    expect(describeTutorialLocator({ kind: "role", role: "button" })).toBe("role=button");
    expect(describeTutorialLocator({ kind: "text", text: "Hi" })).toBe('text="Hi"');
    expect(describeTutorialLocator({ kind: "css", selector: ".x" })).toBe("css=.x");
    expect(describeTutorialLocator({ kind: "test-id", testId: "x" })).toBe("test-id=x");
  });
});

describe("canonical locator resolution is shared", () => {
  // Proves actions and assertions do not carry their own locator mapping: both
  // reach the page through exactly the same call the resolver would make.
  it("actions and assertions both route through the same resolver call shape", async () => {
    const actionPage = createFakePage();
    await executeTutorialAction(
      actionPage,
      { type: "click", locator: { kind: "role", role: "button", name: "Save" } },
      { applicationUrl: "http://127.0.0.1:3000/" }
    );

    const assertionPage = createFakePage({
      locators: { "role:button|name=Save|exact=undefined": { text: "Save" } }
    });
    await executeTutorialAssertion(
      assertionPage,
      { type: "text-equals", locator: { kind: "role", role: "button", name: "Save" }, expected: "Save" },
      { applicationUrl: "http://127.0.0.1:3000/", targetRoot: "/unused" }
    );

    const resolverPage = createFakePage();
    resolveTutorialLocator(resolverPage, { kind: "role", role: "button", name: "Save" });

    expect(actionPage.calls).toEqual(resolverPage.calls);
    expect(assertionPage.calls).toEqual(resolverPage.calls);
  });
});
