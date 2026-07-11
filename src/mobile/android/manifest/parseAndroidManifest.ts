import { readFileSync } from "node:fs";
import path from "node:path";
import { relativeWithinRoot, resolveWithinRoot } from "../../../core/pathSafety.js";
import type { AndroidDetectionResult } from "../detection.js";
import {
  ANDROID_NAMESPACE_URI,
  findChildren,
  getAttribute,
  parseXmlDocument,
  type XmlElement,
  type XmlSourceLocation,
} from "./xml/parseXml.js";
import type {
  AndroidIntentFilter,
  AndroidIntentFilterData,
  AndroidManifestComponent,
  AndroidManifestComponentKind,
  AndroidManifestModel,
  AndroidManifestSourceLocation,
  AndroidPermissionDeclaration,
  AndroidPermissionSourceElement,
  AndroidUsesFeatureDeclaration,
} from "./types.js";

// ---------------------------------------------------------------------------
// v0.4.0 Batch 3 — AndroidManifest.xml parser.
//
// Maps the bounded XML tree from ./xml/parseXml.ts onto the Batch 1
// AndroidManifestModel contract. Static, deterministic, read-only: no
// resource-reference resolution, no manifest-placeholder resolution (values
// like @string/app_name and ${applicationId} are preserved verbatim), and no
// manifest merging. Malformed input always produces a valid (possibly
// mostly-empty) AndroidManifestModel with the problem recorded in
// `parseWarnings`/`unsupportedConstructs` rather than throwing.
// ---------------------------------------------------------------------------

function toLocation(xmlLocation: XmlSourceLocation): AndroidManifestSourceLocation {
  return { line: xmlLocation.line, column: xmlLocation.column };
}

function getUnprefixedAttribute(element: XmlElement, localName: string): string | undefined {
  return element.attributes.find((attr) => attr.prefix === undefined && attr.localName === localName)?.value;
}

function androidAttr(element: XmlElement, localName: string): string | undefined {
  return getAttribute(element, localName, ANDROID_NAMESPACE_URI)?.value;
}

type BooleanAttrResult = { value?: boolean; raw?: string };

function parseBooleanAttr(element: XmlElement, localName: string, warnings: string[], context: string): BooleanAttrResult {
  const attr = getAttribute(element, localName, ANDROID_NAMESPACE_URI);
  if (!attr) return {};
  if (attr.value === "true") return { value: true, raw: attr.value };
  if (attr.value === "false") return { value: false, raw: attr.value };
  warnings.push(
    `${context}: android:${localName} has an unresolved or malformed value "${attr.value}" (line ${attr.location.line}) — not normalized to true or false.`
  );
  return { raw: attr.value };
}

function parseIntAttr(element: XmlElement, localName: string, warnings: string[], context: string): number | undefined {
  const attr = getAttribute(element, localName, ANDROID_NAMESPACE_URI);
  if (!attr) return undefined;
  const parsed = Number.parseInt(attr.value, 10);
  if (Number.isNaN(parsed)) {
    warnings.push(`${context}: android:${localName} is not a resolvable integer ("${attr.value}", line ${attr.location.line}).`);
    return undefined;
  }
  return parsed;
}

const LAUNCHER_ACTION = "android.intent.action.MAIN";
const LAUNCHER_CATEGORY = "android.intent.category.LAUNCHER";
const VIEW_ACTION = "android.intent.action.VIEW";
const BROWSABLE_CATEGORY = "android.intent.category.BROWSABLE";

function parseIntentFilter(element: XmlElement, warnings: string[]): AndroidIntentFilter {
  const actions = findChildren(element, "action")
    .map((a) => androidAttr(a, "name"))
    .filter((v): v is string => Boolean(v));
  const categories = findChildren(element, "category")
    .map((c) => androidAttr(c, "name"))
    .filter((v): v is string => Boolean(v));
  const autoVerifyResult = parseBooleanAttr(element, "autoVerify", warnings, "intent-filter");

  const dataElements: AndroidIntentFilterData[] = findChildren(element, "data").map((d) => ({
    dataScheme: androidAttr(d, "scheme"),
    dataHost: androidAttr(d, "host"),
    dataPath: androidAttr(d, "path"),
    dataPathPrefix: androidAttr(d, "pathPrefix"),
    dataPathPattern: androidAttr(d, "pathPattern"),
    autoVerify: autoVerifyResult.value,
    location: toLocation(d.location),
  }));

  const isDeepLinkCandidate = actions.includes(VIEW_ACTION) && (categories.includes(BROWSABLE_CATEGORY) || dataElements.length > 0);

  for (const child of element.children) {
    if (child.localName !== "action" && child.localName !== "category" && child.localName !== "data") {
      warnings.push(`Unsupported intent-filter child element <${child.tagName}> at line ${child.location.line} (preserved as a warning, not parsed).`);
    }
  }

  return {
    filterData: dataElements,
    actions,
    categories,
    dataElements,
    autoVerify: autoVerifyResult.value,
    isDeepLinkCandidate,
    location: toLocation(element.location),
  };
}

function parseComponent(kind: AndroidManifestComponentKind, element: XmlElement, warnings: string[]): AndroidManifestComponent {
  const context = `<${kind}> at line ${element.location.line}`;
  const name = androidAttr(element, "name");
  if (!name) {
    warnings.push(`${context} is missing android:name.`);
  }

  const exportedResult = parseBooleanAttr(element, "exported", warnings, context);
  const enabledResult = parseBooleanAttr(element, "enabled", warnings, context);
  const permission = androidAttr(element, "permission");

  const intentFilters = findChildren(element, "intent-filter").map((filterEl) => parseIntentFilter(filterEl, warnings));
  const isLauncherActivity =
    (kind === "activity" || kind === "activity-alias") &&
    intentFilters.some((filter) => filter.actions?.includes(LAUNCHER_ACTION) && filter.categories?.includes(LAUNCHER_CATEGORY));

  const component: AndroidManifestComponent = {
    kind,
    name: name ?? "",
    exported: exportedResult.value,
    exportedRaw: exportedResult.raw,
    enabled: enabledResult.value,
    permission,
    intentFilters,
    isLauncherActivity: isLauncherActivity || undefined,
    location: toLocation(element.location),
  };

  if (kind === "provider") {
    component.readPermission = androidAttr(element, "readPermission");
    component.writePermission = androidAttr(element, "writePermission");
    const authoritiesRaw = androidAttr(element, "authorities");
    component.authorities = authoritiesRaw ? authoritiesRaw.split(";").map((s) => s.trim()).filter(Boolean) : undefined;
    component.grantUriPermissions = parseBooleanAttr(element, "grantUriPermissions", warnings, context).value;
  }

  return component;
}

// Parses AndroidManifest.xml source text into the normalized contract. Pure
// (no filesystem access) so it can be unit tested directly against inline
// XML strings.
export function parseAndroidManifestSource(xmlText: string, manifestPath: string): AndroidManifestModel {
  const parseWarnings: string[] = [];
  const unsupportedConstructs: string[] = [];

  const parsed = parseXmlDocument(xmlText);
  for (const warning of parsed.warnings) {
    parseWarnings.push(`${warning.message} (line ${warning.location.line}, column ${warning.location.column})`);
  }

  if (!parsed.ok) {
    parseWarnings.push(`Malformed XML: ${parsed.error.message} (line ${parsed.error.location.line}, column ${parsed.error.location.column})`);
    return {
      manifestPath,
      application: {},
      permissions: [],
      usesFeatures: [],
      activities: [],
      activityAliases: [],
      services: [],
      receivers: [],
      providers: [],
      deepLinks: [],
      parseWarnings,
      unsupportedConstructs,
    };
  }

  const root = parsed.root;
  if (root.localName !== "manifest") {
    parseWarnings.push(`Root element is <${root.tagName}>, not <manifest> — manifest could not be interpreted.`);
    return {
      manifestPath,
      application: {},
      permissions: [],
      usesFeatures: [],
      activities: [],
      activityAliases: [],
      services: [],
      receivers: [],
      providers: [],
      deepLinks: [],
      parseWarnings,
      unsupportedConstructs,
    };
  }

  const packageName = getUnprefixedAttribute(root, "package");

  const permissionElementNames: [string, AndroidPermissionSourceElement][] = [
    ["uses-permission", "uses-permission"],
    ["uses-permission-sdk-23", "uses-permission-sdk-23"],
    ["uses-permission-sdk-m", "uses-permission-sdk-m"],
  ];
  const permissions: AndroidPermissionDeclaration[] = [];
  for (const [elementName, sourceElement] of permissionElementNames) {
    for (const el of findChildren(root, elementName)) {
      const name = androidAttr(el, "name");
      if (!name) {
        parseWarnings.push(`<${elementName}> at line ${el.location.line} is missing android:name.`);
        continue;
      }
      permissions.push({
        name,
        maxSdkVersion: parseIntAttr(el, "maxSdkVersion", parseWarnings, `<${elementName}> "${name}"`),
        sourceElement,
        location: toLocation(el.location),
      });
    }
  }

  const usesFeatures: AndroidUsesFeatureDeclaration[] = findChildren(root, "uses-feature")
    .map((el): AndroidUsesFeatureDeclaration | undefined => {
      const name = androidAttr(el, "name");
      if (!name) {
        parseWarnings.push(`<uses-feature> at line ${el.location.line} is missing android:name.`);
        return undefined;
      }
      return {
        name,
        required: parseBooleanAttr(el, "required", parseWarnings, `<uses-feature> "${name}"`).value,
        location: toLocation(el.location),
      };
    })
    .filter((v): v is AndroidUsesFeatureDeclaration => v !== undefined);

  const applicationElements = findChildren(root, "application");
  const applicationEl = applicationElements[0];
  if (!applicationEl) {
    unsupportedConstructs.push("Manifest has no <application> element.");
  }
  if (applicationElements.length > 1) {
    parseWarnings.push(`Manifest declares ${applicationElements.length} <application> elements; only the first was used.`);
  }

  const application = applicationEl
    ? {
        name: androidAttr(applicationEl, "name"),
        label: androidAttr(applicationEl, "label"),
        iconRef: androidAttr(applicationEl, "icon"),
        enabled: parseBooleanAttr(applicationEl, "enabled", parseWarnings, "<application>").value,
        permission: androidAttr(applicationEl, "permission"),
        allowBackup: parseBooleanAttr(applicationEl, "allowBackup", parseWarnings, "<application>").value,
        debuggable: parseBooleanAttr(applicationEl, "debuggable", parseWarnings, "<application>").value,
        usesCleartextTraffic: parseBooleanAttr(applicationEl, "usesCleartextTraffic", parseWarnings, "<application>").value,
        networkSecurityConfigRef: androidAttr(applicationEl, "networkSecurityConfig"),
      }
    : {};

  const activities = applicationEl ? findChildren(applicationEl, "activity").map((el) => parseComponent("activity", el, parseWarnings)) : [];
  const activityAliases = applicationEl
    ? findChildren(applicationEl, "activity-alias").map((el) => parseComponent("activity-alias", el, parseWarnings))
    : [];
  const services = applicationEl ? findChildren(applicationEl, "service").map((el) => parseComponent("service", el, parseWarnings)) : [];
  const receivers = applicationEl ? findChildren(applicationEl, "receiver").map((el) => parseComponent("receiver", el, parseWarnings)) : [];
  const providers = applicationEl ? findChildren(applicationEl, "provider").map((el) => parseComponent("provider", el, parseWarnings)) : [];

  if (applicationEl) {
    const knownChildNames = new Set(["activity", "activity-alias", "service", "receiver", "provider", "meta-data"]);
    for (const child of applicationEl.children) {
      if (!knownChildNames.has(child.localName)) {
        unsupportedConstructs.push(`Unsupported <application> child element <${child.tagName}> at line ${child.location.line}.`);
      }
    }
  }

  const deepLinks: AndroidIntentFilterData[] = [];
  let launcherActivityName: string | undefined;
  for (const component of [...activities, ...activityAliases]) {
    if (component.isLauncherActivity && !launcherActivityName) {
      launcherActivityName = component.name;
    }
    for (const filter of component.intentFilters) {
      if (filter.isDeepLinkCandidate) {
        deepLinks.push(...(filter.dataElements ?? filter.filterData));
      }
    }
  }

  return {
    manifestPath,
    packageName,
    application,
    permissions,
    usesFeatures,
    activities,
    activityAliases,
    services,
    receivers,
    providers,
    deepLinks,
    launcherActivityName,
    parseWarnings,
    unsupportedConstructs,
  };
}

// Reads and parses a manifest file. `manifestRelativePath` must already be
// target-relative (as returned by AndroidDetectionResult.manifestPaths); this
// re-validates containment before reading so a caller-supplied path can never
// escape targetRoot.
export function parseAndroidManifestFile(targetRoot: string, manifestRelativePath: string): AndroidManifestModel {
  const resolvedRoot = path.resolve(targetRoot);
  let absolutePath: string;
  try {
    absolutePath = resolveWithinRoot(resolvedRoot, manifestRelativePath);
  } catch (error) {
    return {
      manifestPath: manifestRelativePath,
      application: {},
      permissions: [],
      usesFeatures: [],
      activities: [],
      activityAliases: [],
      services: [],
      receivers: [],
      providers: [],
      deepLinks: [],
      parseWarnings: [`Manifest path rejected: ${error instanceof Error ? error.message : "path escapes target root"}`],
      unsupportedConstructs: [],
    };
  }

  const normalizedPath = relativeWithinRoot(resolvedRoot, absolutePath);

  let xmlText: string;
  try {
    xmlText = readFileSync(absolutePath, "utf8");
  } catch (error) {
    return {
      manifestPath: normalizedPath,
      application: {},
      permissions: [],
      usesFeatures: [],
      activities: [],
      activityAliases: [],
      services: [],
      receivers: [],
      providers: [],
      deepLinks: [],
      parseWarnings: [`Could not read manifest file: ${error instanceof Error ? error.message : "unknown error"}`],
      unsupportedConstructs: [],
    };
  }

  return parseAndroidManifestSource(xmlText, normalizedPath);
}

export type AndroidManifestSourceSetKind = "main" | "debug" | "release" | "androidTest" | "test" | "other";

export type AndroidManifestParseEntry = {
  manifestPath: string;
  modulePath?: string;
  sourceSetKind: AndroidManifestSourceSetKind;
  manifest: AndroidManifestModel;
};

const KNOWN_SOURCE_SET_KINDS: readonly AndroidManifestSourceSetKind[] = ["main", "debug", "release", "androidTest", "test"];

function inferSourceSetKind(manifestPath: string): AndroidManifestSourceSetKind {
  const segments = manifestPath.split("/");
  const srcIndex = segments.indexOf("src");
  const sourceSetSegment = srcIndex !== -1 ? segments[srcIndex + 1] : undefined;
  return (KNOWN_SOURCE_SET_KINDS as readonly string[]).includes(sourceSetSegment ?? "")
    ? (sourceSetSegment as AndroidManifestSourceSetKind)
    : "other";
}

function inferModulePath(manifestPath: string): string | undefined {
  const srcIndex = manifestPath.indexOf("/src/");
  return srcIndex === -1 ? undefined : manifestPath.slice(0, srcIndex);
}

// Parses every manifest path from a Batch 2 AndroidDetectionResult
// independently. One malformed manifest never prevents the others from being
// parsed. Does not merge manifests — each entry stands alone, tagged with its
// inferred module and source-set association for later batches to use.
export function parseAllAndroidManifests(targetRoot: string, detection: AndroidDetectionResult): AndroidManifestParseEntry[] {
  const moduleManifestMap = new Map<string, string>();
  for (const module of detection.modules) {
    for (const manifestPath of module.manifestPaths) {
      moduleManifestMap.set(manifestPath, module.path);
    }
  }

  return [...detection.manifestPaths].sort((a, b) => a.localeCompare(b)).map((manifestPath) => ({
    manifestPath,
    modulePath: moduleManifestMap.get(manifestPath) ?? inferModulePath(manifestPath),
    sourceSetKind: inferSourceSetKind(manifestPath),
    manifest: parseAndroidManifestFile(targetRoot, manifestPath),
  }));
}
