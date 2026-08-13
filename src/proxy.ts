import { type NextRequest, NextResponse } from "next/server";

import { SESSION_COOKIE_NAME } from "@/lib/auth-config";
import { ApiError } from "@/lib/api";
import { assertSameOrigin } from "@/lib/csrf";
import { resolveDemoSession } from "@/lib/session-core";

const PUBLIC_PATHS = new Set(["/login", "/api/auth/login", "/api/auth/logout", "/api/health"]);
const UNSAFE_METHODS = new Set(["POST", "PATCH", "PUT", "DELETE"]);

export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  if (PUBLIC_PATHS.has(pathname) || pathname.startsWith("/_next/") || pathname === "/favicon.ico") {
    return NextResponse.next();
  }

  if (UNSAFE_METHODS.has(request.method.toUpperCase())) {
    try {
      assertSameOrigin(request);
    } catch (error) {
      if (error instanceof ApiError && error.status === 403) {
        return NextResponse.json(
          {
            error: {
              code: error.code,
              message: error.message,
              details: error.details ?? null,
            },
          },
          { status: error.status, headers: { "Cache-Control": "no-store" } },
        );
      }
      throw error;
    }
  }

  let session;
  try {
    session = await resolveDemoSession(request.cookies.get(SESSION_COOKIE_NAME)?.value);
  } catch {
    return pathname.startsWith("/api/")
      ? NextResponse.json(
          { error: { code: "AUTH_UNAVAILABLE", message: "Проверка сессии временно недоступна." } },
          { status: 503, headers: { "Cache-Control": "no-store" } },
        )
      : NextResponse.redirect(new URL("/login", request.url));
  }

  if (!session) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json(
        { error: { code: "UNAUTHORIZED", message: "Требуется вход в систему." } },
        { status: 401, headers: { "Cache-Control": "no-store" } },
      );
    }
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("next", `${pathname}${search}`);
    return NextResponse.redirect(loginUrl);
  }

  const isAdminPath =
    pathname === "/admin" ||
    pathname.startsWith("/admin/") ||
    pathname === "/api/admin" ||
    pathname.startsWith("/api/admin/") ||
    pathname.startsWith("/api/mock/admin/");
  const isScenarioWorkspace = pathname === "/admin/scenarios" || pathname.startsWith("/api/admin/scenarios/");
  const canUseScenarioWorkspace = session.authorization.permissionKeys.has("analysis.read") || session.authorization.permissionKeys.has("scenario_template.manage");
  if (isAdminPath && !session.user.roles.includes("ADMIN") && !(isScenarioWorkspace && canUseScenarioWorkspace)) {
    return pathname.startsWith("/api/")
      ? NextResponse.json(
          { error: { code: "FORBIDDEN", message: "Недостаточно прав для выполнения операции." } },
          { status: 403, headers: { "Cache-Control": "no-store" } },
        )
      : NextResponse.redirect(new URL("/", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
