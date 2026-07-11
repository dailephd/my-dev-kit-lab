import type { SecurityFinding } from "../../../../securityValidation/types.js";
import { makeAndroidFinding } from "../../audit/androidFinding.js";
import { makeCandidateEvidence, type CandidateEvidence } from "../candidateEvidence.js";
import { buildAndroidSourceLocation } from "../sourceLocation.js";
import { discoverFirebaseArtifacts } from "./discoverFirebaseArtifacts.js";
import { parseGoogleServicesConfig } from "./parseGoogleServicesConfig.js";
import { parseFirebaseJson, parseFirebaseRc } from "./parseFirebaseConfig.js";
import { parseDatabaseRules } from "./parseDatabaseRules.js";
import { parseFirestoreOrStorageRules } from "./parseFirestoreStorageRules.js";
import {
  collectAnalyticsEventEvidence,
  collectCollectionSetterEvidence,
  collectGradleServiceEvidence,
  collectManifestCollectionMetadata,
  collectSourceServiceEvidence,
} from "./collectFirebaseServiceEvidence.js";
import type { FirebaseArtifactFile, FirebaseServiceUseEvidence } from "./types.js";

// ---------------------------------------------------------------------------
// v0.4.1 Batch 6 — Firebase/Google services analysis: turns discovered
// artifacts and evidence into CandidateEvidence / SecurityFinding using the
// five Batch 1 Firebase/Google rule ids. Never contacts Firebase/Google
// remotely, never claims a local rules file reflects the deployed
// configuration, and never claims a Gradle plugin/dependency was actually
// initialized at runtime.
// ---------------------------------------------------------------------------

export type AnalyzeFirebaseGoogleResult = { candidates: CandidateEvidence[]; findings: SecurityFinding[] };

function fileLocationLine(targetRoot: string, file: FirebaseArtifactFile, line?: number) {
  return buildAndroidSourceLocation(targetRoot, file.absolutePath, { line });
}

export function analyzeFirebaseGoogleServices(targetRoot: string, modulePaths: readonly string[]): AnalyzeFirebaseGoogleResult {
  const candidates: CandidateEvidence[] = [];
  const findings: SecurityFinding[] = [];
  const discovery = discoverFirebaseArtifacts(targetRoot, modulePaths);
  const limitations = [
    "Bounded static analysis of target-contained local files only; does not contact Firebase or Google services, does not verify deployed rules, and does not evaluate Gradle or resolve dependency selection.",
  ];

  const candidate = (
    ruleId: "android-firebase-realtime-database-permissive-rules" | "android-firebase-firestore-permissive-rules" | "android-firebase-storage-permissive-rules" | "android-firebase-missing-local-rules" | "android-firebase-google-configuration-evidence",
    file: FirebaseArtifactFile,
    summary: string,
    rawValue: string | undefined,
    confidence: "low" | "medium" | "high" = "medium",
    resolutionState: "resolved" | "unresolved" | "missing" | "malformed" | "not-applicable" = "resolved",
    line?: number
  ) =>
    candidates.push(
      makeCandidateEvidence({
        ruleId,
        category: "android-firebase-google-services",
        confidence,
        modulePath: file.modulePath,
        location: fileLocationLine(targetRoot, file, line),
        summary,
        rawValue,
        resolutionState,
        staticAnalysisLimitations: limitations,
      })
    );

  const permissiveFinding = (
    ruleId: "android-firebase-realtime-database-permissive-rules" | "android-firebase-firestore-permissive-rules" | "android-firebase-storage-permissive-rules",
    file: FirebaseArtifactFile,
    title: string,
    line: number | undefined,
    evidenceDetails: string[]
  ) =>
    findings.push(
      makeAndroidFinding({
        ruleId,
        title,
        severity: "major",
        confidence: "high",
        description: `${title}. This reflects a local rules file only; it is not proof of the currently deployed configuration.`,
        manifestPath: file.relativePath,
        identity: `${ruleId}:${line ?? 0}`,
        location: { line },
        evidenceDetails,
        recommendation: "Restrict the rule to authenticated, authorized access before deploying, and verify the deployed rules match the local file.",
      })
    );

  // --- google-services.json -------------------------------------------------
  const googleServicesConfigs = discovery.googleServicesFiles.map(parseGoogleServicesConfig);
  for (const config of googleServicesConfigs) {
    if (config.malformed) {
      candidate("android-firebase-google-configuration-evidence", config.file, "google-services.json could not be parsed as JSON", undefined, "low", "malformed");
      continue;
    }
    candidate(
      "android-firebase-google-configuration-evidence",
      config.file,
      `google-services.json parsed: project=${config.projectId ?? "(none)"}, clients=${config.clients.length}, apiKeys=${config.clients.reduce((n, c) => n + c.apiKeyCount, 0)}`,
      config.projectId,
      "low",
      "not-applicable"
    );

    const manifestPackages = discovery.manifestFiles
      .map((m) => /\bpackage\s*=\s*"([^"]+)"/.exec(m.content)?.[1])
      .filter((v): v is string => Boolean(v));
    if (manifestPackages.length > 0) {
      const matchingClients = config.clients.filter((c) => c.packageName !== undefined && manifestPackages.includes(c.packageName));
      if (matchingClients.length === 0) {
        candidate("android-firebase-google-configuration-evidence", config.file, "No google-services.json client matches the detected application package", undefined, "medium", "unresolved");
      } else if (matchingClients.length > 1) {
        candidate("android-firebase-google-configuration-evidence", config.file, "Multiple google-services.json clients match the detected application package", undefined, "medium", "unresolved");
      }
    }
  }

  // --- firebase.json / .firebaserc ------------------------------------------
  const firebaseJsonConfigs = discovery.firebaseJsonFiles.map(parseFirebaseJson);
  for (const config of firebaseJsonConfigs) {
    if (config.malformed) {
      candidate("android-firebase-google-configuration-evidence", config.file, "firebase.json could not be parsed as JSON", undefined, "low", "malformed");
    }
  }
  for (const rc of discovery.firebaseRcFiles.map(parseFirebaseRc)) {
    if (rc.malformed) {
      candidate("android-firebase-google-configuration-evidence", rc.file, ".firebaserc could not be parsed as JSON", undefined, "low", "malformed");
    } else if (Object.keys(rc.aliases).length > 0) {
      candidate("android-firebase-google-configuration-evidence", rc.file, `.firebaserc project alias metadata: ${Object.keys(rc.aliases).join(", ")}`, rc.defaultProject, "low", "not-applicable");
    }
  }

  // --- rules resolution (referenced by firebase.json, or conventional names) --
  const referencedPaths = new Set(firebaseJsonConfigs.flatMap((c) => [...c.databaseRulesPaths, ...c.firestoreRulesPaths, ...c.storageRulesPaths]));
  for (const firebaseJson of discovery.firebaseJsonFiles) {
    const config = firebaseJsonConfigs.find((c) => c.file === firebaseJson);
    if (!config) continue;
    for (const rulesPath of [...config.databaseRulesPaths, ...config.firestoreRulesPaths, ...config.storageRulesPaths]) {
      const normalized = rulesPath.replace(/^\.?\//, "");
      const resolved =
        discovery.databaseRulesJsonFiles.find((f) => f.relativePath.endsWith(normalized)) ??
        discovery.rulesFiles.find((f) => f.relativePath.endsWith(normalized));
      if (!resolved) {
        candidate("android-firebase-missing-local-rules", firebaseJson, `firebase.json references "${rulesPath}", but that rules file was not found in the target`, rulesPath, "medium", "missing");
      }
    }
  }
  void referencedPaths;

  // --- Realtime Database rules -----------------------------------------------
  for (const dbRulesFile of discovery.databaseRulesJsonFiles) {
    const result = parseDatabaseRules(dbRulesFile);
    if (result.malformed) {
      candidate("android-firebase-google-configuration-evidence", dbRulesFile, "database.rules.json could not be parsed as JSON", undefined, "low", "malformed");
      continue;
    }
    for (const entry of result.entries) {
      if ((entry.operation === ".read" || entry.operation === ".write") && entry.literalBoolean === true) {
        permissiveFinding(
          "android-firebase-realtime-database-permissive-rules",
          dbRulesFile,
          `Realtime Database ${entry.operation} rule at ${entry.jsonPath} is unconditionally true`,
          undefined,
          [`path=${entry.jsonPath}`, `operation=${entry.operation}`]
        );
      } else if (entry.operation === ".read" || entry.operation === ".write") {
        candidate(
          "android-firebase-google-configuration-evidence",
          dbRulesFile,
          `Realtime Database ${entry.operation} rule at ${entry.jsonPath}: ${entry.conditionSummary}`,
          entry.conditionSummary,
          "low",
          "not-applicable"
        );
      }
    }
  }

  // --- Firestore / Storage rules ----------------------------------------------
  for (const rulesFile of discovery.rulesFiles) {
    const isStorage = /storage\.rules$/i.test(rulesFile.relativePath) || /service\s+firebase\.storage/.test(rulesFile.content);
    const isFirestore = !isStorage && (/firestore\.rules$/i.test(rulesFile.relativePath) || /service\s+cloud\.firestore/.test(rulesFile.content));
    if (!isStorage && !isFirestore) continue;
    const service = isStorage ? "storage" : "firestore";
    const result = parseFirestoreOrStorageRules(rulesFile, service);
    const ruleId = isStorage ? "android-firebase-storage-permissive-rules" : "android-firebase-firestore-permissive-rules";

    for (const match of result.matches) {
      if (match.isLiteralTrue && !match.hasAuthCondition) {
        permissiveFinding(ruleId, rulesFile, `${service === "storage" ? "Storage" : "Firestore"} rule at ${match.matchPath} allows ${match.operations.join(", ")} unconditionally`, match.line, [
          `path=${match.matchPath}`,
          `operations=${match.operations.join(",")}`,
        ]);
      } else if (match.isTestModeTimeCondition) {
        candidate("android-firebase-google-configuration-evidence", rulesFile, `Time-limited test-mode rule at ${match.matchPath}: ${match.conditionSummary}`, match.conditionSummary, "medium", "not-applicable", match.line);
      } else if (!match.hasAuthCondition && !match.isLiteralFalse) {
        candidate("android-firebase-google-configuration-evidence", rulesFile, `Unresolved/complex rule condition at ${match.matchPath}: ${match.conditionSummary}`, match.conditionSummary, "low", "unresolved", match.line);
      }
    }
  }

  // --- Gradle + source service-use evidence -----------------------------------
  const allServiceEvidence: FirebaseServiceUseEvidence[] = [
    ...discovery.gradleFiles.flatMap(collectGradleServiceEvidence),
    ...discovery.sourceFiles.flatMap(collectSourceServiceEvidence),
  ];
  const servicesUsed = new Set(allServiceEvidence.map((e) => e.service));
  if (allServiceEvidence.length > 0) {
    const gradleFile = discovery.gradleFiles[0] ?? discovery.sourceFiles[0];
    if (gradleFile) {
      candidate(
        "android-firebase-google-configuration-evidence",
        gradleFile,
        `Firebase service-use evidence found for: ${[...servicesUsed].sort().join(", ")}`,
        undefined,
        "low",
        "not-applicable"
      );
    }
  }

  const anyRulesResolved = discovery.databaseRulesJsonFiles.length > 0 || discovery.rulesFiles.length > 0;
  const anchorFile = discovery.gradleFiles[0] ?? discovery.sourceFiles[0];
  if (anchorFile) {
    if (servicesUsed.has("database") && discovery.databaseRulesJsonFiles.length === 0) {
      candidate("android-firebase-missing-local-rules", anchorFile, "Realtime Database service use detected but no local database.rules.json was found", undefined, "medium", "missing");
    }
    if (servicesUsed.has("firestore") && !discovery.rulesFiles.some((f) => /firestore\.rules$/i.test(f.relativePath) || /service\s+cloud\.firestore/.test(f.content))) {
      candidate("android-firebase-missing-local-rules", anchorFile, "Firestore service use detected but no local firestore.rules was found", undefined, "medium", "missing");
    }
    if (servicesUsed.has("storage") && !discovery.rulesFiles.some((f) => /storage\.rules$/i.test(f.relativePath) || /service\s+firebase\.storage/.test(f.content))) {
      candidate("android-firebase-missing-local-rules", anchorFile, "Storage service use detected but no local storage.rules was found", undefined, "medium", "missing");
    }
  }
  void anyRulesResolved;

  // --- collection / auto-init metadata -----------------------------------------
  for (const manifest of discovery.manifestFiles) {
    for (const meta of collectManifestCollectionMetadata(manifest)) {
      candidate(
        "android-firebase-google-configuration-evidence",
        manifest,
        `${meta.name} manifest metadata is ${meta.state} (${meta.rawValue})`,
        meta.rawValue,
        "low",
        meta.state === "dynamic" ? "unresolved" : "not-applicable",
        meta.line
      );
    }
  }
  for (const source of discovery.sourceFiles) {
    for (const setter of collectCollectionSetterEvidence(source)) {
      candidate(
        "android-firebase-google-configuration-evidence",
        source,
        `${setter.service} collection setter called with state=${setter.state}`,
        undefined,
        "low",
        setter.state === "dynamic" ? "unresolved" : "not-applicable",
        setter.line
      );
    }
  }

  // --- analytics event parameter review ------------------------------------------
  for (const source of discovery.sourceFiles) {
    for (const event of collectAnalyticsEventEvidence(source)) {
      if (event.sensitiveParameterKey === undefined) continue;
      if (event.isDirectLiteralValue) {
        findings.push(
          makeAndroidFinding({
            ruleId: "android-firebase-google-configuration-evidence",
            title: "Direct sensitive value sent as a Firebase Analytics event parameter",
            severity: "major",
            confidence: "high",
            description: "A directly visible sensitive parameter key/value was passed to a Firebase Analytics logEvent() Bundle in the same method. Static source evidence only; does not prove the event was uploaded.",
            manifestPath: source.relativePath,
            identity: `analytics-event:${event.line}`,
            location: { line: event.line },
            evidenceDetails: [`key=${event.sensitiveParameterKey}`],
            recommendation: "Do not send credentials or highly sensitive personal data as analytics event parameters.",
          })
        );
      } else {
        candidate(
          "android-firebase-google-configuration-evidence",
          source,
          `Sensitive-looking analytics event parameter key "${event.sensitiveParameterKey}" with a dynamic value`,
          event.sensitiveParameterValueExpression,
          "medium",
          "unresolved",
          event.line
        );
      }
    }
  }

  return { candidates, findings };
}
