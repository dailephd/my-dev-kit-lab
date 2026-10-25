import type { AttackScenario, AttackScenarioContext, AttackScenarioRunOutcome } from "../attackScenario.js";
import { makeEvidence } from "../exploitEvidence.js";
import { collectBoundedSourceFiles, lineNumberAt } from "../boundedSourceScan.js";
import { createHash } from "node:crypto";

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

// Reviewed source identities, not file exemptions. A changed site, extra match,
// missing dependency, or changed caller precondition invalidates recognition.
const REVIEWED_LOCAL_HTTP_SITES = [
  { file: "src/runtime/managedProcess.ts", symbol: "waitForReadiness", sha256: "978dacaf401cac3c3f6fdc96ca92163b766b14bead7f3a7c49b1ca28d8ac3900", dependencies: {} },
  { file: "src/tutorial/tutorialAssertions.ts", symbol: "http-json-equals / resolveAssertionRequestUrl", sha256: "eba83bd94342d108e1ecc8491e09e584360095823332dffe2df28e49ecf011b3", dependencies: {
    "src/tutorial/runTutorial.ts": "ded69670f0aec6ad31e714e77c6a8e769abcb28fcdc68b81584fd582e593e298",
    "src/tutorial/tutorialSession.ts": "5cb1d9084575c0e1221851146293233fb6a963e214689a710f89cd49cb64647a",
    "src/tutorial/targetContractValidation.ts": "da6c51c36827bf3d9b7375cdd71e488d35732f389f989a7dbc462b21063a96a6",
    "src/tutorial/loadTutorialContracts.ts": "10e17f851febf783076d2d7ad5de70f6e950308819ec30edaecf749ba4b11c7a",
    "src/tutorial/validationPrimitives.ts": "e49258d33d0a88d051fa783d8e2236827940ed5895fd1ce844b9f58b4ec08cb1"
  } }
] as const;

const sourceDigest = (content: string): string => createHash("sha256").update(content, "utf8").digest("hex");

type NetworkMatch = {
  id: string;
  file: string;
  line: number;
  intentional: boolean;
  reviewedSite?: string;
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
    const byPath = new Map(files.map(file => [file.relativePath, file.content]));
    for (const site of REVIEWED_LOCAL_HTTP_SITES) {
      const content = byPath.get(site.file);
      if (content === undefined) continue;
      const siteMatches = allMatches.filter(match => match.file === site.file);
      const recognized = sourceDigest(content) === site.sha256 &&
        siteMatches.length === 1 && siteMatches[0]?.id === "fetch-call" &&
        Object.entries(site.dependencies).every(([file, sha256]) => {
          const dependency = byPath.get(file);
          return dependency !== undefined && sourceDigest(dependency) === sha256;
        });
      if (recognized) {
        siteMatches[0]!.intentional = true;
        siteMatches[0]!.reviewedSite = `${site.symbol}; source SHA-256 ${site.sha256}`;
      } else if (siteMatches.length === 0) {
        allMatches.push({ id: "reviewed-local-http-source-mismatch", file: site.file, line: 1, intentional: false });
      }
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
        observedBehavior: `${intentional.filter(m => !m.reviewedSite).length} match(es) found under known network-using paths (${KNOWN_NETWORK_INTENTIONAL_PREFIXES.join(", ")}).`,
      }),
      ...intentional.filter(m => m.reviewedSite).map(m => makeEvidence({
        kind: "observation", source: "known-intentional local HTTP use", filePath: m.file, line: m.line,
        confidence: "medium",
        expectedBehavior: "Exactly one reviewed fetch-call with unchanged local HTTP guards and caller preconditions. Bounded static findings do not prove full runtime network isolation.",
        observedBehavior: `Recognized '${m.id}' in ${m.file}:${m.line} (${m.reviewedSite}).`
      })),
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
