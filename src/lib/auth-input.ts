import { z } from "zod";

export const loginInputSchema = z
  .object({
    login: z.string().trim().min(1).max(64),
    password: z.string().min(1).max(256),
  })
  .strict();

export function safeReturnPath(value: string | null | undefined): string {
  if (!value) return "/";
  let decoded = value;
  try {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const next = decodeURIComponent(decoded);
      if (next === decoded) break;
      decoded = next;
    }
  } catch {
    return "/";
  }
  if (!isAllowedReturnValue(decoded)) return "/";
  const base = "https://mtr.invalid";
  try {
    const parsed = new URL(decoded, base);
    const normalized = `${parsed.pathname}${parsed.search}${parsed.hash}`;
    return parsed.origin === base && isAllowedReturnValue(normalized) ? normalized : "/";
  } catch {
    return "/";
  }
}

function isAllowedReturnValue(value: string): boolean {
  return (
    value.startsWith("/") &&
    !value.startsWith("//") &&
    !value.startsWith("/login") &&
    !value.includes("\\") &&
    !/[\u0000-\u001F\u007F]/u.test(value)
  );
}
