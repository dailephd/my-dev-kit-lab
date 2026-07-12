import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { auditAndroidWebViewSecurity } from "../../../../src/mobile/android/advancedSecurity/webview/checkResult.js";
import type { AndroidDetectionResult } from "../../../../src/mobile/android/detection.js";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });
function target(source: string): string { const root = fs.mkdtempSync(path.join(os.tmpdir(), "webview-audit-")); roots.push(root); fs.mkdirSync(path.join(root, "app/src/main/java/example"), { recursive: true }); fs.writeFileSync(path.join(root, "app/src/main/java/example/Main.java"), source); return root; }
function detection(): AndroidDetectionResult { return { detected: true, confidence: "high", evidence: [], projectKind: "application", uiToolkit: "xml-view", hasGradleWrapper: false, gradleSettingsFiles: [], rootBuildFiles: [], versionCatalogFiles: [], modules: [{ path: "app", kind: "application", manifestPaths: [] }], applicationModules: ["app"], libraryModules: [], manifestPaths: [], javaSourceRoots: [], kotlinSourceRoots: [], unitTestSourceRoots: [], instrumentedTestSourceRoots: [], partialOrUnsupportedStructure: false, warnings: [] }; }
describe("standalone WebView security audit", () => {
  it("finds high-confidence explicit settings and same-receiver bridge correlation deterministically", () => {
    const root = target('void x(){ settings.setJavaScriptEnabled(true); settings.addJavascriptInterface(bridge, "bridge"); settings.setAllowUniversalAccessFromFileURLs(true); WebView.setWebContentsDebuggingEnabled(true); }');
    const first = auditAndroidWebViewSecurity(root, detection()); const second = auditAndroidWebViewSecurity(root, detection());
    expect(first).toEqual(second); expect(first.category).toBe("android-webview");
    expect(first.findings.map((item) => item.id).join(" ")).toContain("android-webview-javascript-interface-exposure");
    expect(first.findings.map((item) => item.id).join(" ")).toContain("android-webview-universal-file-url-access");
  });
  it("does not correlate distinct receivers and preserves dynamic loads as candidates", () => {
    const root = target("void x(){ a.setJavaScriptEnabled(true); b.addJavascriptInterface(bridge, name); a.loadUrl(url); }");
    const result = auditAndroidWebViewSecurity(root, detection());
    expect(result.findings.some((item) => item.id.includes("javascript-interface-exposure"))).toBe(false);
    expect(result.candidateEvidence?.some((item) => item.ruleId === "android-webview-suspicious-url-loading")).toBe(true);
  });
  it("scopes proceed to onReceivedSslError and ignores comments and strings", () => {
    const root = target('void elsewhere(){ handler.proceed(); String s = "x.proceed()"; /* view.setJavaScriptEnabled(true) */ } void onReceivedSslError(){ handler.proceed(); handler.cancel(); }');
    const result = auditAndroidWebViewSecurity(root, detection());
    expect(result.findings.filter((item) => item.id.includes("ssl-error-proceed"))).toHaveLength(1);
    expect(result.candidateEvidence?.some((item) => item.ruleId === "android-webview-javascript-enabled")).toBe(false);
  });
  it("supports Kotlin property settings and keeps correlations method-local", () => {
    const root = target('fun one(){ web.settings.javaScriptEnabled = true; web.settings.allowFileAccessFromFileURLs = true; web.loadUrl("javascript:run()") } fun two(){ web.addJavascriptInterface(bridge, "x") } fun three(){ web.settings.mixedContentMode = WebSettings.MIXED_CONTENT_ALWAYS_ALLOW; web.loadUrl("http://example.invalid") }');
    const result = auditAndroidWebViewSecurity(root, detection()); const ids = result.findings.map((item) => item.id).join(" ");
    expect(ids).toContain("android-webview-file-content-access"); expect(ids).toContain("android-webview-mixed-content");
    expect(ids).not.toContain("javascript-interface-exposure");
  });
  it("classifies safe, dynamic, mixed-content, debugging, and URL-loading branches with bounded evidence", () => {
    const large = "x".repeat(600);
    const root = target(`void inspect(){ web.getSettings().setJavaScriptEnabled(flag); web.getSettings().setAllowFileAccess(false); web.getSettings().setAllowContentAccess(true); web.getSettings().setMixedContentMode(WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE); WebView.setWebContentsDebuggingEnabled(dynamic); web.loadUrl("https://example.invalid"); web.loadUrl("http://example.invalid"); web.postUrl(url, bytes); web.loadData("${large}", "text/html", "UTF-8"); web.loadDataWithBaseURL(base, html, "text/html", "UTF-8", null); }`);
    const result = auditAndroidWebViewSecurity(root, detection());
    expect(result.candidateEvidence?.some((item) => item.summary.includes("dynamic or unresolved"))).toBe(true);
    expect(result.candidateEvidence?.some((item) => item.summary.includes("compatibility"))).toBe(true);
    expect(result.candidateEvidence?.some((item) => item.summary.includes("literal scheme"))).toBe(true);
    expect(JSON.stringify(result)).not.toContain(large);
    expect(result.findings.some((item) => item.id.includes("debugging-enabled"))).toBe(false);
  });
  it("correlates a direct settings alias with its WebView only in the same method", () => {
    const root = target('void configure(){ WebSettings settings = web.getSettings(); settings.setJavaScriptEnabled(true); web.addJavascriptInterface(bridge, "Bridge"); }');
    const result = auditAndroidWebViewSecurity(root, detection());
    expect(result.findings.some((item) => item.id.includes("javascript-interface-exposure"))).toBe(true);
  });
});
