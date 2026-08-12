import { NextResponse } from "next/server";
import { ZodError } from "zod";

import { SessionError } from "@/lib/session";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export function ok<T>(data: T, init?: ResponseInit): NextResponse<T> {
  return NextResponse.json(data, init);
}

export function created<T>(data: T): NextResponse<T> {
  return NextResponse.json(data, { status: 201 });
}

export function toErrorResponse(error: unknown): NextResponse {
  if (error instanceof ApiError) {
    return NextResponse.json(
      { error: { code: error.code, message: error.message, details: error.details ?? null } },
      { status: error.status },
    );
  }
  if (error instanceof SessionError) {
    return NextResponse.json(
      { error: { code: error.status === 403 ? "FORBIDDEN" : "UNAUTHORIZED", message: error.message } },
      { status: error.status },
    );
  }
  if (error instanceof ZodError) {
    return NextResponse.json(
      {
        error: {
          code: "VALIDATION_ERROR",
          message: "Проверьте переданные данные",
          details: { issues: error.issues },
        },
      },
      { status: 400 },
    );
  }

  const requestId = crypto.randomUUID();
  console.error("Unhandled API error", {
    requestId,
    errorType: safeErrorType(error),
  });
  return NextResponse.json(
    {
      error: {
        code: "INTERNAL_ERROR",
        message: "Не удалось выполнить операцию. Повторите попытку.",
        requestId,
      },
    },
    { status: 500 },
  );
}

function safeErrorType(error: unknown): string {
  if (error instanceof TypeError) return "TYPE_ERROR";
  if (error instanceof RangeError) return "RANGE_ERROR";
  if (error instanceof SyntaxError) return "SYNTAX_ERROR";
  if (error instanceof Error) return "ERROR";
  return "NON_ERROR_THROWN";
}

export async function parseJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new ApiError(400, "INVALID_JSON", "Тело запроса должно содержать корректный JSON");
  }
}
