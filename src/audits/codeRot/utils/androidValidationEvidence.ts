import type { AuditDetectorContext } from "../../core/auditRegistry.js";
import { readBoundedFileText } from "./boundedRead.js";

const MAX_READ_BYTES = 200_000;

export type AndroidImplementation = "implemented" | "absent" | "unknown";

export function androidValidationImplementation(ctx: AuditDetectorContext): AndroidImplementation {
  const { inventory, sourceOfTruth, target } = ctx;
  const pkg = sourceOfTruth.package;
  if (!pkg) return "unknown";
  const scripts = Object.entries(pkg.scripts).filter(([name, command]) =>
    /^android:(?:validate|audit)$|^(?:validate|audit):android$|^security:validate$/.test(name) ||
    /(?:^|\s)--profile(?:\s+|=)android(?:\s|$)/.test(command));
  if (!scripts.length) return pkg.bin || inventory.warnings.length ? "unknown" : "absent";
  for (const [name, command] of scripts) {
    // Recognize a direct, inventoried entry. Compound scripts and unknown
    // launchers leave the implementation unqualified.
    const entryPath = /^(?:node|tsx) +(?:\.\/)?([\w.-]+(?:\/[\w.-]+)*)(?:\s+--profile(?:\s+|=)android)?$/.exec(command.trim())?.[1];
    const entry = inventory.files.find(file => file.relativePath === entryPath && file.role !== "test");
    if (!entry || !/\.[cm]?[jt]s$/.test(entry.relativePath)) continue;
    const text = readBoundedFileText(target.rootPath, entry.relativePath, entry.sizeBytes, MAX_READ_BYTES);
    if (!text) continue;
    const declaration = /^export\s+(?:async\s+)?function\s+(validateAndroid\w*|runAndroidValidation\w*)\s*\(/m.exec(text);
    if (name !== "security:validate" && declaration &&
        new RegExp("^(?:await\\s+)?" + declaration[1] + "\\(", "m").test(text)) {
      return "implemented";
    }
    // Lab exposes Android through its existing security validation route.
    // Require the registered entry, real delegation, and the route handler.
    if (name !== "security:validate" || !sourceOfTruth.security.hasSecurityValidationSourceDir ||
        !/\brunSecurityValidationCommand(?:FromArgs)?\s*\(/.test(text)) continue;
    const handler = inventory.sourceFiles.find(file => /(?:^|\/)runSecurityValidationCommand\.[cm]?[jt]s$/.test(file.relativePath));
    if (!handler) continue;
    const implementation = readBoundedFileText(target.rootPath, handler.relativePath, handler.sizeBytes, MAX_READ_BYTES);
    if (implementation && /\bconfig\.profile\s*===\s*"android"/.test(implementation) &&
        inventory.sourceFiles.some(file => /(?:^|\/)android\/validate\//.test(file.relativePath))) return "implemented";
  }
  return "unknown";
}
