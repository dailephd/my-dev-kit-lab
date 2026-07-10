import type { AndroidGradleDistributionType } from "./types.js";

// ---------------------------------------------------------------------------
// v0.4.0 Batch 4 — gradle/wrapper/gradle-wrapper.properties parsing.
//
// Pure text parsing (no filesystem access) so it is directly unit testable.
// Never claims wrapper JAR authenticity or checksum correctness — only that
// a distributionSha256Sum property is *present*, not that it is valid.
// ---------------------------------------------------------------------------

export type ParsedWrapperProperties = {
  distributionUrl?: string;
  gradleVersion?: string;
  distributionType: AndroidGradleDistributionType;
  checksumPropertyPresent: boolean;
  warnings: string[];
};

const DISTRIBUTION_URL_PATTERN = /^distributionUrl\s*=\s*(.+)$/m;
const CHECKSUM_PROPERTY_PATTERN = /^distributionSha256Sum\s*=\s*(.+)$/m;
// Gradle distribution URLs look like:
//   https\://services.gradle.org/distributions/gradle-8.5-bin.zip
// (the colon is escaped because .properties files use `\:` for literal
// colons in values). Captures the version and bin/all distribution type.
const GRADLE_VERSION_PATTERN = /gradle-(\d+(?:\.\d+){1,3}(?:-\w+)?)-(bin|all)\.zip/;

function unescapePropertiesValue(raw: string): string {
  return raw.trim().replace(/\\:/g, ":").replace(/\\\//g, "/");
}

export function parseWrapperProperties(text: string): ParsedWrapperProperties {
  const warnings: string[] = [];
  const urlMatch = text.match(DISTRIBUTION_URL_PATTERN);
  const distributionUrl = urlMatch ? unescapePropertiesValue(urlMatch[1]) : undefined;
  const checksumPropertyPresent = CHECKSUM_PROPERTY_PATTERN.test(text);

  if (!distributionUrl) {
    warnings.push("gradle-wrapper.properties has no distributionUrl property.");
    return { distributionType: "unknown", checksumPropertyPresent, warnings };
  }

  const versionMatch = distributionUrl.match(GRADLE_VERSION_PATTERN);
  if (!versionMatch) {
    warnings.push(`Could not deterministically extract a Gradle version from distributionUrl: "${distributionUrl}".`);
    return { distributionUrl, distributionType: "unknown", checksumPropertyPresent, warnings };
  }

  return {
    distributionUrl,
    gradleVersion: versionMatch[1],
    distributionType: versionMatch[2] as AndroidGradleDistributionType,
    checksumPropertyPresent,
    warnings,
  };
}
