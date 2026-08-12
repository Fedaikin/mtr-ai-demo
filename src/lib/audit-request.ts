import "server-only";

/**
 * Correlation identifiers are generated inside the trusted server boundary.
 * Caller-controlled request headers are deliberately ignored because they may
 * contain credentials or misleading identifiers.
 */
export function createAuditCorrelationId(): string {
  return `request-${crypto.randomUUID()}`;
}
