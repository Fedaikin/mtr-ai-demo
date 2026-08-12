const RAW_USER_ENUM_VALUES = [
  "ACCESS_DENIED",
  "ACTIVE",
  "ADMIN",
  "ALTERNATIVE",
  "ANALOGUES",
  "APPIUS_NEW_VERSION",
  "AVAILABLE",
  "BASE",
  "CANCELLED",
  "CLASSIFYING_RESPONSIBILITY",
  "COMPLETED",
  "COMPOSITE_ANALOGUE",
  "CONTRACTOR",
  "CUSTOMER",
  "DRY_RUN",
  "EXACT",
  "FAILED",
  "FAILURE",
  "FINDING_ANALOGUES",
  "FOUND",
  "FULL",
  "GENERATING_REPORT",
  "INSUFFICIENT",
  "LATEST",
  "LIKELY",
  "LOADING_APPIUS",
  "MALFORMED_RESPONSE",
  "MATCHING_STOCK",
  "NORMAL",
  "NOT_FOUND",
  "NOT_RECOMMENDED",
  "NO_MATCH",
  "PARSED",
  "PRIMARY",
  "QUEUED",
  "RATE_LIMITED",
  "REVIEW",
  "REVIEW_REQUIRED",
  "SAP_FAILURE",
  "SINGLE",
  "SLOW",
  "STALE",
  "STALE_VERSION",
  "STARTED",
  "STOCK_ONLY",
  "SUCCESS",
  "SUITABLE",
  "SUPERSEDED",
  "SYNCING_SAP",
  "UNAVAILABLE",
  "USER",
  "ALL_CURRENT_SPECIFICATIONS",
] as const;

const alternatives = [...new Set(RAW_USER_ENUM_VALUES)]
  .toSorted((left, right) => right.length - left.length)
  .join("|");

/** Contract for strings that must be localized before reaching a user-facing surface. */
export const RAW_USER_ENUM_PATTERN = new RegExp(
  `(?<![\\p{L}\\p{N}_-])(?<![A-Z0-9]\\.)(?:${alternatives})(?![\\p{L}\\p{N}_-])`,
  "u",
);

export function findRawUserEnum(value: string): string | undefined {
  return value.match(RAW_USER_ENUM_PATTERN)?.[0];
}
