const REDACTED = "[СКРЫТО]";
const TRUNCATED = "…";

const SENSITIVE_KEY_PARTS = [
  "authorization",
  "cookie",
  "setcookie",
  "password",
  "passwd",
  "secret",
  "token",
  "apikey",
  "databaseurl",
  "connectionstring",
  "privatekey",
  "credential",
  "sessionid",
] as const;

const RAW_CONTENT_KEYS = new Set([
  "body",
  "content",
  "document",
  "documentbody",
  "documentcontent",
  "documenttext",
  "filecontent",
  "message",
  "payload",
  "prompt",
  "raw",
  "rawdocument",
  "rawresponse",
  "stack",
  "stacktrace",
  "systemprompt",
]);

const JWT_PATTERN = /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/gu;
const AUTH_PATTERN = /\b(Bearer|Basic)\s+[A-Za-z0-9+/_=.-]{6,}/giu;
const URL_CREDENTIAL_PATTERN = /(https?:\/\/)[^\s:/@]+:[^\s@/]+@/giu;
const ASSIGNMENT_PATTERN = /\b(password|passwd|secret|token|api[_-]?key)\s*[:=]\s*([^\s,;]+)/giu;

export interface RedactionOptions {
  maxDepth?: number;
  maxArrayItems?: number;
  maxStringLength?: number;
}

const DEFAULT_OPTIONS: Required<RedactionOptions> = {
  maxDepth: 8,
  maxArrayItems: 50,
  maxStringLength: 500,
};

/**
 * Recursively removes credentials and raw document/model payloads before they
 * cross a persistence or presentation boundary. The function is deliberately
 * pure so every audit surface uses the same policy.
 */
export function redactSensitiveData(
  value: unknown,
  options: RedactionOptions = {},
): unknown {
  return redactValue(value, "", 0, { ...DEFAULT_OPTIONS, ...options });
}

export function redactSensitiveRecord(
  value: Record<string, unknown> | undefined,
  options: RedactionOptions = {},
): Record<string, unknown> {
  if (!value) return {};
  const redacted = redactSensitiveData(value, options);
  return isRecord(redacted) ? redacted : {};
}

export function safeAuditPreview(value: unknown, maxLength = 420): string {
  const serialized = JSON.stringify(
    redactSensitiveData(value, { maxStringLength: Math.min(maxLength, 500) }),
  );
  if (!serialized) return "—";
  return serialized.length <= maxLength
    ? serialized
    : `${serialized.slice(0, Math.max(0, maxLength - 1))}${TRUNCATED}`;
}

function redactValue(
  value: unknown,
  key: string,
  depth: number,
  options: Required<RedactionOptions>,
): unknown {
  if (isSensitiveKey(key)) return REDACTED;
  if (depth >= options.maxDepth) return "[ГЛУБИНА ОГРАНИЧЕНА]";
  if (typeof value === "string") return sanitizeString(value, options.maxStringLength);
  if (typeof value === "number" || typeof value === "boolean" || value === null) return value;
  if (value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) {
    const items = value
      .slice(0, options.maxArrayItems)
      .map((item) => redactValue(item, key, depth + 1, options));
    if (value.length > options.maxArrayItems) items.push(`[ЕЩЁ ${value.length - options.maxArrayItems}]`);
    return items;
  }
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value).flatMap(([childKey, childValue]) =>
        childValue === undefined
          ? []
          : [[childKey, redactValue(childValue, childKey, depth + 1, options)]],
      ),
    );
  }
  return String(value).slice(0, options.maxStringLength);
}

function isSensitiveKey(key: string): boolean {
  if (!key) return false;
  const normalized = key.replace(/[^a-zа-яё0-9]/giu, "").toLowerCase();
  if (normalized === "promptversion" || normalized === "messageLength".toLowerCase()) return false;
  return (
    RAW_CONTENT_KEYS.has(normalized) ||
    SENSITIVE_KEY_PARTS.some((part) => normalized.includes(part))
  );
}

function sanitizeString(value: string, maxLength: number): string {
  const sanitized = value
    .replace(JWT_PATTERN, REDACTED)
    .replace(AUTH_PATTERN, (_match, scheme: string) => `${scheme} ${REDACTED}`)
    .replace(URL_CREDENTIAL_PATTERN, `$1${REDACTED}@`)
    .replace(ASSIGNMENT_PATTERN, (_match, name: string) => `${name}=${REDACTED}`);
  return sanitized.length <= maxLength
    ? sanitized
    : `${sanitized.slice(0, Math.max(0, maxLength - 1))}${TRUNCATED}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
