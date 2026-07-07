import type { AttackScenario, AttackScenarioContext, AttackScenarioRunOutcome } from "../attackScenario.js";
import { makeEvidence } from "../exploitEvidence.js";
import { collectBoundedSourceFiles, lineNumberAt } from "../boundedSourceScan.js";

// ---------------------------------------------------------------------------
// v0.2.2 Batch 4 — network / local-first assumption scenario.
//
// Careful, narrow claim only: a bounded static scan of local-first source
// paths (manifests, src/, scripts/) finding no obvious unexpected network-API
// usage. This is NOT proof of runtime network isolation — subprocess-invoked
// tools (npm audit/outdated, OSV-Scanner, Semgrep's npx fallback) legitimately
// contact the network when those check groups are selected, and this
// scenario does not and cannot verify their runtime behavior. No network
// calls, probes, or instrumentation are performed by this scenario itself.
// ---------------------------------------------------------------------------

const NETWORK_API_PATTERNS: Array<{ id: string; regex: RegExp }> = [
  { id: "fetch-call", regex: /\bfetch\s*\(/g },
  { id: "http-module-import", regex: /(?:require\(\s*["']https?["']\s*\)|from\s+["']https?["'])/g },
  { id: "net-tls-module-import", regex: /(?:require\(\s*["'](?:net|tls)["']\s*\)|from\s+["'](?:net|tls)["'])/g },
  { id: "axios-import", regex: /(?:require\(\s*["']axios["']\s*\)|from\s+["']axios["'])/g },
  { id: "got-import", regex: /(?:require\(\s*["']got["']\s*\)|from\s+["']got["'])/g },
  { id: "request-import", regex: /(?:require\(\s*["']request["']\s*\)|from\s+["']request["'])/g },
  { id: "undici-import", regex: /(?:require\(\s*["']undici["']\s*\)|from\s+["']undici["'])/g },
  { id: "node-fetch-import", regex: /(?:require\(\s*["']node-fetch["']\s*\)|from\s+["']node-fetch["'])/g },
  { id: "websocket-usage", regex: /new\s+WebSocket\s*\(/g },
];

// Paths where network-touching behavior is expected and intentional (they
// shell out to npm/OSV-Scanner/etc, not a local-first-source violation).
const KNOWN_NETWORK_INTENTIONAL_PREFIXES = [
  "src/securityValidation/dependencies/",
  "src/securityValidation/staticScans/",
];

function isKnownIntentionalPath(relativePath: string): boolean {
  return KNOWN_NETWORK_INTENTIONAL_PREFIXES.some((p) => relativePath.startsWith(p));
}

type NetworkMatch = {
  id: string;
  file: string;
  line: number;
  intentional: boolean;
};

function scanFileForNetworkApis(relativePath: string, content: string): NetworkMatch[] {
  const matches: NetworkMatch[] = [];
  const intentional = isKnownIntentionalPath(relativePath);
  for (const { id, regex } of NETWORK_API_PATTERNS) {
    const re = new RegExp(regex.source, regex.flags);
    let match: RegExpExecArray | null;
    while ((match = re.exec(content)) !== null) {
      if (match[0].length === 0) {
        re.lastIndex += 1;
        continue;
      }
      matches.push({ id, file: relativePath, line: lineNumberAt(content, match.index), intentional });
    }
  }
  return matches;
}

export const NETWORK_ASSUMPTION_SCENARIO: AttackScenario = {
  id: "network-local-first-bounded-scan",
  title: "Network assumption: bounded static scan finds no unexpected network API usage in local-first source",
  description:
    "Bounded static scan of local-first source paths (manifests, src/, scripts/) for obvious network API usage (fetch/http/https/net/tls/axios/got/request/undici/node-fetch/WebSocket). Known network-using validation commands (npm audit, npm outdated, OSV-Scanner) are treated as expected, not violations. This does not prove runtime network isolation.",
  checkId: "network",
  applicableProfiles: [],
  severityBaseline: "informational",
  verdictImpact: "target-project-blocker",
  expectedSafeBehavior:
    "No obvious unexpected network API usage is found in the bounded local-first source paths inspected.",
  evidenceRequirements: ["observation"],
  run: async (ctx: AttackScenarioContext): Promise<AttackScenarioRunOutcome> => {
    const files = collectBoundedSourceFiles(ctx.target.targetRoot);
    const isolationCaveat = makeEvidence({
      kind: "observation",
      source: "scope statement",
      confidence: "high",
      expectedBehavior:
        "This is a bounded static check of local-first source paths only. It does not prove runtime network isolation of subprocess-invoked tools (npm, CodeQL, Semgrep, OSV-Scanner) or any other process spawned during validation.",
      observedBehavior: "Static-source-only claim; no runtime network instrumentation was performed.",
    });

    if (files.length === 0) {
      return {
        status: "passed",
        confidence: "low",
        evidence: [
          isolationCaveat,
          makeEvidence({
            kind: "observation",
            source: "bounded network scan file collection",
            confidence: "low",
            expectedBehavior: "At least one file would be scanned for a meaningful bounded-scan claim.",
            observedBehavior:
              "0 files matched the bounded glob set. No findings because there was nothing to scan.",
          }),
        ],
      };
    }

    const allMatches: NetworkMatch[] = [];
    for (const file of files) {
      allMatches.push(...scanFileForNetworkApis(file.relativePath, file.content));
    }
    allMatches.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);

    const unexpected = allMatches.filter((m) => !m.intentional);
    const intentional = allMatches.filter((m) => m.intentional);

    const evidence = [
      isolationCaveat,
      makeEvidence({
        kind: "observation",
        source: "bounded network API scan",
        confidence: "medium",
        expectedBehavior: "Bounded scan of manifests/src/scripts for direct network API usage.",
        observedBehavior: `${files.length} file(s) scanned; ${unexpected.length} unexpected match(es), ${intentional.length} known-intentional match(es).`,
      }),
      makeEvidence({
        kind: "observation",
        source: "known network-using validation commands",
        confidence: "high",
        expectedBehavior:
          "npm audit / npm outdated (deps check) may contact the npm registry; OSV-Scanner may contact the OSV API; Semgrep's npx fallback may contact the npm registry. These are expected when those check groups are selected via --checks and are not local-first source violations.",
        observedBehavior: `${intentional.length} match(es) found under known network-using paths (${KNOWN_NETWORK_INTENTIONAL_PREFIXES.join(", ")}).`,
      }),
      ...unexpected.slice(0, 20).map((m) =>
        makeEvidence({
          kind: "observation",
          source: `pattern '${m.id}'`,
          filePath: m.file,
          line: m.line,
          confidence: "medium",
          expectedBehavior: "No unexpected direct network API usage in local-first source paths.",
          observedBehavior: `Detected '${m.id}' usage in ${m.file}:${m.line}.`,
        })
      ),
    ];

    if (unexpected.length > 0) {
      return {
        status: "failed",
        confidence: "medium",
        evidence,
        severity: "major",
        recommendation: `Review ${unexpected.length} unexpected network-API usage(s) in local-first source paths and confirm they are intentional, or move them under a clearly network-using module.`,
      };
    }

    return { status: "passed", confidence: "medium", evidence };
  },
};
