import { NextResponse } from "next/server";

import { initializeDatabase } from "@/adapters/persistence/bootstrap";
import { getRepository } from "@/adapters/persistence/repository";
import type { PersistedDemoSession } from "@/lib/session-core";
import { DEMO_USER_DISPLAY_NAME, DEMO_USER_ID } from "@/domain/models";
import { createAuditCorrelationId } from "@/lib/audit-request";
import { clearSessionCookie } from "@/lib/auth-cookie";
import { SESSION_COOKIE_NAME } from "@/lib/auth-config";
import { assertSameOrigin } from "@/lib/csrf";
import { ApiError, toErrorResponse } from "@/lib/api";
import { resolveDemoSession, revokeDemoSession } from "@/lib/session-core";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const correlationId = createAuditCorrelationId();
  let auditAttempted = false;
  try {
    assertSameOrigin(request);
    const token = request.headers
      .get("cookie")
      ?.split(";")
      .map((part) => part.trim().split("="))
      .find(([name]) => name === SESSION_COOKIE_NAME)?.[1];
    const session = await resolveDemoSession(token);
    await revokeDemoSession(token);
    auditAttempted = true;
    await writeLogoutAudit(correlationId, session);
    const response = new NextResponse(null, {
      status: 204,
      headers: { "Cache-Control": "no-store" },
    });
    clearSessionCookie(response);
    return response;
  } catch (error) {
    if (!auditAttempted) {
      try {
        await writeLogoutAudit(correlationId, null, authenticationErrorCode(error));
      } catch (auditError) {
        console.error("Logout audit write failed", {
          correlationId,
          errorType: auditError instanceof Error ? auditError.name : "UNKNOWN",
        });
      }
    }
    return toErrorResponse(error);
  }
}

async function writeLogoutAudit(
  correlationId: string,
  session: PersistedDemoSession | null,
  errorCode = "SESSION_NOT_FOUND",
): Promise<void> {
  await initializeDatabase();
  const repository = await getRepository();
  if (session) {
    await repository.writeAudit(session.user.id, {
      actorDisplayName: session.user.displayName,
      action: "AUTH_LOGOUT_SUCCEEDED",
      entityType: "AUTH_SESSION",
      entityId: session.id,
      outcome: "SUCCESS",
      requestId: correlationId,
      details: {
        correlationId,
        sessionRevoked: true,
      },
    });
    return;
  }

  await repository.writeAudit(DEMO_USER_ID, {
    actorDisplayName: DEMO_USER_DISPLAY_NAME,
    action: "AUTH_LOGOUT_FAILED",
    entityType: "AUTHENTICATION",
    outcome: "FAILURE",
    requestId: correlationId,
    details: {
      correlationId,
      errorCode,
      sessionRevoked: false,
    },
  });
}

function authenticationErrorCode(error: unknown): string {
  return error instanceof ApiError ? error.code : "INTERNAL_ERROR";
}
