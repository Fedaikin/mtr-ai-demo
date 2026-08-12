import { ApiError } from "@/lib/api";

export function assertSameOrigin(request: Request): void {
  const origin = request.headers.get("origin");
  if (!origin) return;

  const requestHost = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    throw new ApiError(403, "INVALID_ORIGIN", "Источник запроса не разрешён.");
  }
  if (!requestHost || originHost !== requestHost) {
    throw new ApiError(403, "INVALID_ORIGIN", "Источник запроса не разрешён.");
  }
}
