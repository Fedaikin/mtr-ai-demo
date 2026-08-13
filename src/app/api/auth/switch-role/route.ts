import { NextResponse } from "next/server";
import { z } from "zod";

import { getRepository } from "@/adapters/persistence/repository";
import { DEMO_PERSONA_LOGINS, landingPathForPermissions } from "@/domain/demo-personas";
import { setSessionCookie } from "@/lib/auth-cookie";
import { SESSION_COOKIE_NAME } from "@/lib/auth-config";
import { ApiError, parseJson, toErrorResponse } from "@/lib/api";
import { assertSameOrigin } from "@/lib/csrf";
import { createDemoPersonaSession, resolveDemoSession, revokeDemoSession } from "@/lib/session-core";

const inputSchema = z.object({ login: z.enum(DEMO_PERSONA_LOGINS) });

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    if (process.env.DEMO_ROLE_SELECTOR !== "true") throw new ApiError(404, "ROLE_SELECTOR_DISABLED", "Переключатель ролей отключён");
    const token = readCookie(request.headers.get("cookie"), SESSION_COOKIE_NAME);
    const current = await resolveDemoSession(token);
    if (!current) throw new ApiError(401, "UNAUTHORIZED", "Требуется вход в систему");
    if (!current.user.isSyntheticDemo) throw new ApiError(403, "FORBIDDEN", "Переключение доступно только в демонстрационном контуре");
    const input = inputSchema.parse(await parseJson(request));
    const next = await createDemoPersonaSession(input.login);
    await revokeDemoSession(token);
    const repository = await getRepository();
    await repository.writeAudit(next.user.id, { actorDisplayName: current.user.displayName, action: "DEMO_ROLE_SWITCHED", entityType: "AUTH_SESSION", entityId: next.id, outcome: "SUCCESS", requestId: crypto.randomUUID(), details: { fromUserId: current.user.id, toUserId: next.user.id } }).catch((error: unknown) => console.error("Demo role switch audit failed", { errorType: error instanceof Error ? error.name : "UNKNOWN" }));
    const response = NextResponse.json({ user: next.user, redirectTo: landingPathForPermissions(next.authorization.permissionKeys) }, { headers: { "cache-control": "no-store" } });
    setSessionCookie(response, next.token, next.expiresAt);
    return response;
  } catch (error) { return toErrorResponse(error); }
}

function readCookie(header: string | null, name: string): string | undefined {
  return header?.split(";").map((part) => part.trim().split("=")).find(([key]) => key === name)?.[1];
}
