export interface AuditEntry {
  actor: string;
  action: string;
  email?: string;
  token?: string;
}

export function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (!local || !domain) {
    return "[invalid-email]";
  }
  return `${local[0]}***@${domain}`;
}

export function redactAuditEntry(entry: AuditEntry): AuditEntry {
  const redacted: AuditEntry = { actor: entry.actor, action: entry.action };
  if (entry.email !== undefined) {
    redacted.email = maskEmail(entry.email);
  }
  if (entry.token !== undefined) {
    redacted.token = "[redacted]";
  }
  return redacted;
}
