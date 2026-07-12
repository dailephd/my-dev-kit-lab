import path from "node:path";
import type { SecurityFinding } from "../../../../securityValidation/types.js";
import type { AndroidDetectionResult } from "../../detection.js";
import { makeAndroidFinding } from "../../audit/androidFinding.js";
import type { AndroidCheckResult } from "../../validation/checkResult.js";
import { makeCandidateEvidence, type CandidateEvidence } from "../candidateEvidence.js";
import { sortCandidateEvidence } from "../ordering.js";
import { buildAndroidSourceLocation } from "../sourceLocation.js";
import { discoverSecretSourceFiles } from "../secretCandidates/discoverSecretSourceFiles.js";

export const ANDROID_WEBVIEW_SECURITY_AUDIT_CHECK_ID = "android-webview-security-audit";

type Call = { receiver: string; method: string; argument: string; line: number; context: string; inSslCallback: boolean };
const CALL = /(?:([A-Za-z_][\w.]*(?:\.getSettings\(\))?)\.)?(setJavaScriptEnabled|addJavascriptInterface|setAllowFileAccess|setAllowContentAccess|setAllowFileAccessFromFileURLs|setAllowUniversalAccessFromFileURLs|setMixedContentMode|setWebContentsDebuggingEnabled|loadUrl|postUrl|loadData|loadDataWithBaseURL|proceed|cancel)\s*\(([^\n)]*)\)/g;
const PROPERTY = /([A-Za-z_][\w.]*)\.(javaScriptEnabled|allowFileAccess|allowContentAccess|allowFileAccessFromFileURLs|allowUniversalAccessFromFileURLs|mixedContentMode)\s*=\s*([^;\n}]+)/g;
const SETTINGS_ALIAS = /(?:\bWebSettings\s+|\b(?:val|var)\s+)([A-Za-z_]\w*)\s*=\s*([A-Za-z_][\w.]*)\s*(?:\.getSettings\(\)|\.settings)/g;
const MAX_ARGUMENT = 240;

function lineAt(text: string, offset: number): number { return text.slice(0, offset).split("\n").length; }
// Masks comments and string *contents* while preserving offsets/newlines.
// Calls are matched only in code; the original text is then used for the
// bounded argument summary. This intentionally local scanner is not a Java
// or Kotlin parser and never attempts type/provenance resolution.
function executableMask(source: string): string {
  let out = ""; let i = 0; let state: "code" | "line" | "block" | "quote" | "raw" = "code"; let quote = "";
  while (i < source.length) { const ch = source[i], next = source[i + 1];
    if (state === "code" && ch === "/" && next === "/") { out += "  "; i += 2; state = "line"; continue; }
    if (state === "code" && ch === "/" && next === "*") { out += "  "; i += 2; state = "block"; continue; }
    if (state === "code" && source.slice(i, i + 3) === '\"\"\"') { out += '\"\"\"'; i += 3; state = "raw"; continue; }
    if (state === "code" && (ch === '"' || ch === "'")) { quote = ch; out += ch; i++; state = "quote"; continue; }
    if (state === "line") { out += ch === "\n" ? "\n" : " "; if (ch === "\n") state = "code"; i++; continue; }
    if (state === "block") { out += ch === "\n" ? "\n" : " "; if (ch === "*" && next === "/") { out = out.slice(0, -1) + "  "; i += 2; state = "code"; } else i++; continue; }
    if (state === "raw") { if (source.slice(i, i + 3) === '\"\"\"') { out += '\"\"\"'; i += 3; state = "code"; } else { out += ch === "\n" ? "\n" : " "; i++; } continue; }
    if (state === "quote") { if (ch === "\\") { out += "  "; i += 2; continue; } out += ch === "\n" ? "\n" : (ch === quote ? ch : " "); if (ch === quote) state = "code"; i++; continue; }
    out += ch; i++;
  } return out;
}
function braceEnd(mask: string, open: number): number { let depth = 0; for (let i = open; i < mask.length; i++) { if (mask[i] === "{") depth++; else if (mask[i] === "}" && --depth === 0) return i; } return mask.length; }
function scopeRanges(mask: string): Array<{ from: number; to: number; id: string }> { const ranges: Array<{ from: number; to: number; id: string }> = []; const header = /(?:\bfun\s+([A-Za-z_]\w*)\s*\([^)]*\)|\b(?:public|private|protected|override|static|final|suspend|void|[A-Z][\w<>?\[\]]*)[\s\w<>?\[\]]*?\s+([A-Za-z_]\w*)\s*\([^)]*\))\s*\{/g; for (const match of mask.matchAll(header)) { const from = (match.index ?? 0); const open = from + match[0].length - 1; ranges.push({ from, to: braceEnd(mask, open), id: `${match[1] ?? match[2] ?? "scope"}@${from}` }); } return ranges; }
function sslRanges(mask: string): Array<[number, number]> { const ranges: Array<[number, number]> = []; for (const match of mask.matchAll(/onReceivedSslError\s*\([^)]*\)\s*\{/g)) { const start = (match.index ?? 0) + match[0].length - 1; ranges.push([start, braceEnd(mask, start)]); } return ranges; }
function literal(argument: string): "true" | "false" | undefined {
  const trimmed = argument.trim();
  return trimmed === "true" ? "true" : trimmed === "false" ? "false" : undefined;
}
function finding(ruleId: string, title: string, file: string, line: number, identity: string, severity: "major" | "minor"): SecurityFinding {
  return makeAndroidFinding({ ruleId, title, severity, confidence: "high", description: `${title}. This is static source evidence only and does not prove runtime execution or exploitability.`, manifestPath: file, identity, location: { line }, recommendation: "Review the configuration and keep WebView capabilities limited to documented requirements." });
}
function candidate(ruleId: any, targetRoot: string, file: { absolutePath: string; relativePath: string; modulePath?: string }, line: number, summary: string, rawValue: string): CandidateEvidence {
  return makeCandidateEvidence({ ruleId, category: "android-webview", confidence: "medium", modulePath: file.modulePath, location: buildAndroidSourceLocation(targetRoot, file.absolutePath, { line }), summary, rawValue: rawValue.slice(0, MAX_ARGUMENT), resolutionState: "resolved", staticAnalysisLimitations: ["Bounded lexical source analysis; receiver types, call ordering, and dynamic values are not resolved."] });
}

export function auditAndroidWebViewSecurity(targetRoot: string, detection: AndroidDetectionResult): AndroidCheckResult {
  if (detection.projectKind === "non-android") return { id: ANDROID_WEBVIEW_SECURITY_AUDIT_CHECK_ID, category: "android-webview", title: "Android WebView security audit", status: "unsupported", requirementLevel: "optional", ran: false, skipped: true, skipInfo: { checkId: ANDROID_WEBVIEW_SECURITY_AUDIT_CHECK_ID, reason: "Target was not detected as Android.", requirementLevel: "optional", verdictImpact: "does not apply", recommendedNextAction: "Run against an Android project." }, evidence: [], findings: [], warnings: [], errors: [], sourcePaths: [], confidence: "unknown", environmentRequirements: [], candidateEvidence: [] };
  const discovered = discoverSecretSourceFiles(targetRoot, detection.modules.map((m) => m.path));
  const files = discovered.files.filter((file) => /\.(java|kt)$/.test(file.relativePath));
  const findings: SecurityFinding[] = []; const candidates: CandidateEvidence[] = [];
  for (const file of files) {
    const mask = executableMask(file.content); const ssl = sslRanges(mask); const scopes = scopeRanges(mask); const calls: Call[] = []; const contextAt = (offset: number) => scopes.filter((scope) => offset >= scope.from && offset <= scope.to).sort((a, b) => a.to - a.from - (b.to - b.from))[0]?.id ?? "(unresolved-scope)"; const aliases = new Map<string, string>(); for (const match of mask.matchAll(SETTINGS_ALIAS)) aliases.set(`${contextAt(match.index ?? 0)}:${match[1]}`, match[2]); const normalize = (receiver: string, method: string, context: string) => { const stripped = receiver.replace(/\.getSettings\(\)$|\.settings$/, ""); if (stripped !== receiver) return stripped; if (method.startsWith("set") && aliases.has(`${context}:${receiver}`)) return aliases.get(`${context}:${receiver}`)!; return receiver; }; CALL.lastIndex = 0;
    for (let match; (match = CALL.exec(mask)); ) {
      const start = match.index; const original = file.content.slice(start, start + match[0].length); const argument = original.slice(original.indexOf("(") + 1, -1).slice(0, MAX_ARGUMENT); const line = lineAt(file.content, start);
      const context = contextAt(start); calls.push({ receiver: normalize(match[1] ?? "(unresolved)", match[2], context), method: match[2], argument, line, context, inSslCallback: ssl.some(([from, to]) => start > from && start < to) });
    }
    PROPERTY.lastIndex = 0; for (let match; (match = PROPERTY.exec(mask)); ) { const start = match.index; const original = file.content.slice(start, start + match[0].length); const eq = original.indexOf("="); const propertyToMethod: Record<string, string> = { javaScriptEnabled: "setJavaScriptEnabled", allowFileAccess: "setAllowFileAccess", allowContentAccess: "setAllowContentAccess", allowFileAccessFromFileURLs: "setAllowFileAccessFromFileURLs", allowUniversalAccessFromFileURLs: "setAllowUniversalAccessFromFileURLs", mixedContentMode: "setMixedContentMode" }; const method = propertyToMethod[match[2]], context = contextAt(start); calls.push({ receiver: normalize(match[1], method, context), method, argument: original.slice(eq + 1).trim().slice(0, MAX_ARGUMENT), line: lineAt(file.content, start), context, inSslCallback: ssl.some(([from, to]) => start > from && start < to) }); }
    for (const call of calls) {
      const value = literal(call.argument);
      if (call.method === "setAllowUniversalAccessFromFileURLs" && value === "true") findings.push(finding("android-webview-universal-file-url-access", "WebView universal file URL access is explicitly enabled", file.relativePath, call.line, call.context, "major"));
      else if (call.method === "setMixedContentMode" && /MIXED_CONTENT_ALWAYS_ALLOW|0\b/.test(call.argument)) findings.push(finding("android-webview-mixed-content", "WebView mixed content is explicitly always allowed", file.relativePath, call.line, call.context, "major"));
      else if (call.method === "setWebContentsDebuggingEnabled" && value === "true" && /(?:^|\.)WebView$/.test(call.receiver)) findings.push(finding("android-webview-debugging-enabled", "WebView debugging is explicitly enabled", file.relativePath, call.line, call.context, "minor"));
      else if (call.method === "proceed" && call.inSslCallback) findings.push(finding("android-webview-ssl-error-proceed", "SSL error callback proceeds despite the certificate error", file.relativePath, call.line, call.context, "major"));
      else if (call.method === "setJavaScriptEnabled" && value !== "false") candidates.push(candidate("android-webview-javascript-enabled", targetRoot, file, call.line, value === "true" ? "JavaScript is explicitly enabled" : "JavaScript enablement is dynamic or unresolved", call.argument));
      else if (["setAllowFileAccess", "setAllowContentAccess", "setAllowFileAccessFromFileURLs", "setAllowUniversalAccessFromFileURLs"].includes(call.method) && value !== "false") candidates.push(candidate(call.method === "setAllowUniversalAccessFromFileURLs" ? "android-webview-universal-file-url-access" : "android-webview-file-content-access", targetRoot, file, call.line, `WebView ${call.method} is ${value === "true" ? "enabled" : "dynamic or unresolved"}`, call.argument));
      else if (call.method === "addJavascriptInterface") candidates.push(candidate("android-webview-javascript-interface-exposure", targetRoot, file, call.line, "JavaScript interface registration source evidence", call.argument));
      else if (call.method === "setMixedContentMode" && /MIXED_CONTENT_COMPATIBILITY_MODE|1\b/.test(call.argument)) candidates.push(candidate("android-webview-mixed-content", targetRoot, file, call.line, "WebView mixed-content compatibility mode is configured", call.argument));
      else if (call.method === "setMixedContentMode" && !/MIXED_CONTENT_NEVER_ALLOW|2\b/.test(call.argument)) candidates.push(candidate("android-webview-mixed-content", targetRoot, file, call.line, "WebView mixed-content mode is dynamic or unresolved", call.argument));
      else if (call.method === "setWebContentsDebuggingEnabled" && value !== "false") candidates.push(candidate("android-webview-debugging-enabled", targetRoot, file, call.line, "WebView debugging state is dynamic or receiver context is unresolved", call.argument));
      else if (["loadUrl", "postUrl", "loadData", "loadDataWithBaseURL"].includes(call.method)) {
        if (/^\s*["']javascript:/i.test(call.argument)) candidates.push(candidate("android-webview-suspicious-url-loading", targetRoot, file, call.line, "javascript: WebView URL loading evidence", call.argument));
        else if (/^\s*["'](?:http|file|content):/i.test(call.argument)) candidates.push(candidate("android-webview-suspicious-url-loading", targetRoot, file, call.line, "WebView loads a review-oriented literal scheme", call.argument));
        else if (!/^\s*["']https:/i.test(call.argument)) candidates.push(candidate("android-webview-suspicious-url-loading", targetRoot, file, call.line, "Dynamic or unsupported WebView content loading argument", call.argument));
      }
    }
    for (const [from, to] of ssl) { const contained = calls.filter((call) => call.inSslCallback && call.method === "proceed" || call.inSslCallback && call.method === "cancel"); if (contained.length === 0) candidates.push(candidate("android-webview-ssl-error-proceed", targetRoot, file, lineAt(file.content, from), mask.slice(from, Math.min(to, from + MAX_ARGUMENT)).trim() ? "SSL error callback delegates or has unresolved local behavior" : "SSL error callback is empty", file.content.slice(from, Math.min(to, from + MAX_ARGUMENT)))); }
    const same = (a: Call, b: Call) => a.receiver !== "(unresolved)" && a.receiver === b.receiver && a.context === b.context;
    for (const js of calls.filter((c) => c.method === "setJavaScriptEnabled" && literal(c.argument) === "true")) for (const bridge of calls.filter((c) => c.method === "addJavascriptInterface" && same(c, js))) findings.push(finding("android-webview-javascript-interface-exposure", "JavaScript and addJavascriptInterface occur on the same receiver in one method", file.relativePath, bridge.line, `${js.receiver}:${js.context}`, "major"));
    for (const js of calls.filter((c) => c.method === "setJavaScriptEnabled" && literal(c.argument) === "true")) for (const access of calls.filter((c) => ["setAllowFileAccessFromFileURLs", "setAllowUniversalAccessFromFileURLs"].includes(c.method) && literal(c.argument) === "true" && same(c, js))) findings.push(finding("android-webview-file-content-access", "JavaScript and file URL access occur on the same receiver in one method", file.relativePath, access.line, `${js.receiver}:${js.context}`, "major"));
    for (const js of calls.filter((c) => c.method === "setJavaScriptEnabled" && literal(c.argument) === "true")) for (const url of calls.filter((c) => c.method === "loadUrl" && /^\s*["']javascript:/i.test(c.argument) && same(c, js))) findings.push(finding("android-webview-suspicious-url-loading", "JavaScript is enabled and a javascript: URL is loaded on the same receiver", file.relativePath, url.line, `${js.receiver}:${js.context}`, "major"));
    for (const mixed of calls.filter((c) => c.method === "setMixedContentMode" && /MIXED_CONTENT_ALWAYS_ALLOW|0\b/.test(c.argument))) for (const url of calls.filter((c) => c.method === "loadUrl" && /^\s*["']http:\/\//i.test(c.argument) && same(c, mixed))) findings.push(finding("android-webview-mixed-content", "Always-allowed mixed content and HTTP loading occur on the same receiver", file.relativePath, url.line, `${mixed.receiver}:${mixed.context}`, "major"));
  }
  const uniqueFindings = [...new Map(findings.map((item) => [item.id, item])).values()].sort((a, b) => a.id.localeCompare(b.id));
  const uniqueCandidates = [...new Map(candidates.map((item) => [item.id, item])).values()];
  return { id: ANDROID_WEBVIEW_SECURITY_AUDIT_CHECK_ID, category: "android-webview", title: "Android WebView security audit", status: uniqueFindings.length ? "failed" : "passed", requirementLevel: "required", ran: true, skipped: false, evidence: [`${files.length} Java/Kotlin file(s) scanned`], findings: uniqueFindings, warnings: [...discovered.skipped.map((item) => `${item.relativePath}: skipped (${item.reason})`), "Static analysis only: no compiler, runtime, URL provenance, or whole-program analysis was used."], errors: [], sourcePaths: files.map((file) => file.relativePath), confidence: discovered.skipped.length ? "medium" : "high", environmentRequirements: [], candidateEvidence: sortCandidateEvidence(uniqueCandidates) };
}
