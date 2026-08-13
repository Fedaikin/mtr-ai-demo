import { NextResponse } from "next/server";
import { ZodError } from "zod";

import { initializeDatabase } from "@/adapters/persistence/bootstrap";
import { getRepository } from "@/adapters/persistence/repository";
import type { CreatedDemoSession } from "@/lib/session-core";
import { DEMO_USER_DISPLAY_NAME, DEMO_USER_ID } from "@/domain/models";
import { loginInputSchema } from "@/lib/auth-input";
import { setSessionCookie } from "@/lib/auth-cookie";
import { createAuditCorrelationId } from "@/lib/audit-request";
import { assertSameOrigin } from "@/lib/csrf";
import { ApiError, parseJson, toErrorResponse } from "@/lib/api";
import { authenticateDemoCredentials } from "@/lib/session-core";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const correlationId = createAuditCorrelationId();
  let auditAttempted = false;
  try {
    assertSameOrigin(request);
    const input = loginInputSchema.parse(await parseJson(request));
    const session = await authenticateDemoCredentials(input.login, input.password);
    if (!session) {
      const error = new ApiError(401, "INVALID_CREDENTIALS", "Неверный логин или пароль.");
      auditAttempted = true;
      await writeLoginAudit(correlationId, { errorCode: error.code });
      return toErrorResponse(error);
    }

    auditAttempted = true;
    await writeLoginAudit(correlationId, { session });
    const response = NextResponse.json(
      {
        user: session.user,
        expiresAt: session.expiresAt,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
    setSessionCookie(response, session.token, session.expiresAt);
    return response;
  } catch (error) {
    if (!auditAttempted) {
      try {
        await writeLoginAudit(correlationId, { errorCode: authenticationErrorCode(error) });
      } catch (auditError) {
        console.error("Login audit failed after authentication error", {
          correlationId,
          authenticationError: safeErrorMessage(error),
          auditError: safeErrorMessage(auditError),
        });
      }
    }
    console.error("Authentication request failed", { correlationId, error: safeErrorMessage(error) });
    return toErrorResponse(error);
  }
}

function safeErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message.slice(0, 500) : "Non-error failure";
}

async function writeLoginAudit(
  correlationId: string,
  result: { session: CreatedDemoSession } | { errorCode: string },
): Promise<void> {
  await initializeDatabase();
  const repository = await getRepository();
  if ("session" in result) {
    await repository.writeAudit(result.session.user.id, {
      actorDisplayName: result.session.user.displayName,
      action: "AUTH_LOGIN_SUCCEEDED",
      entityType: "AUTH_SESSION",
      entityId: result.session.id,
      outcome: "SUCCESS",
      requestId: correlationId,
      details: {
        correlationId,
        authenticationMethod: "DEMO_CREDENTIALS",
      },
    });
    return;
  }

  await repository.writeAudit(DEMO_USER_ID, {
    actorDisplayName: DEMO_USER_DISPLAY_NAME,
    action: "AUTH_LOGIN_FAILED",
    entityType: "AUTHENTICATION",
    outcome: "FAILURE",
    requestId: correlationId,
    details: {
      correlationId,
      errorCode: result.errorCode,
    },
  });
}

function authenticationErrorCode(error: unknown): string {
  if (error instanceof ApiError) return error.code;
  if (error instanceof ZodError) return "VALIDATION_ERROR";
  return "INTERNAL_ERROR";
}
