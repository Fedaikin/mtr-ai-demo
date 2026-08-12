import "server-only";

export const DEMO_LOGIN = "demo";
export const SESSION_COOKIE_NAME = "mtr_session";
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 12;

export function getConfiguredDemoPasswordHash(): string | undefined {
  return process.env.DEMO_PASSWORD_HASH?.trim() || undefined;
}

export function isDemoMode(): boolean {
  const localDefault = process.env.NODE_ENV === "development" || process.env.NODE_ENV === "test";
  return (process.env.APP_MODE ?? (localDefault ? "demo" : "")) === "demo";
}

export function shouldUseSecureSessionCookie(): boolean {
  return process.env.SESSION_COOKIE_SECURE === "true" || Boolean(process.env.VERCEL);
}
