import "server-only";

import { cache } from "react";
import { cookies } from "next/headers";

import type { DemoUser, UserRole } from "@/domain/models";
import { requirePermission as assertPermission, type TrustedRequestContext } from "@/application/authorization-service";
import type { PermissionKey } from "@/domain/rbac";
import { SESSION_COOKIE_NAME } from "@/lib/auth-config";
import { resolveDemoSession } from "@/lib/session-core";

export interface DemoSession {
  id: string;
  user: DemoUser;
  expiresAt: string;
  authorization: TrustedRequestContext;
}

export async function requirePermission(permission: PermissionKey): Promise<DemoSession> {
  const session = await getDemoSession();
  try {
    assertPermission(session.authorization, permission);
  } catch {
    throw new SessionError("Недостаточно прав для выполнения операции", 403);
  }
  return session;
}

export async function requireAnyPermission(permissions: readonly PermissionKey[]): Promise<DemoSession> {
  const session = await getDemoSession();
  if (!permissions.some((permission) => session.authorization.permissionKeys.has(permission))) {
    throw new SessionError("Недостаточно прав для выполнения операции", 403);
  }
  return session;
}

export const getOptionalDemoSession = cache(async (): Promise<DemoSession | null> => {
  const cookieStore = await cookies();
  return resolveDemoSession(cookieStore.get(SESSION_COOKIE_NAME)?.value);
});

export async function getDemoSession(): Promise<DemoSession> {
  const session = await getOptionalDemoSession();
  if (!session) throw new SessionError("Требуется вход в систему", 401);
  return session;
}

export async function requireDemoRole(role: UserRole): Promise<DemoSession> {
  const session = await getDemoSession();
  if (!session.user.roles.includes(role)) {
    throw new SessionError("Недостаточно прав для выполнения операции", 403);
  }
  return session;
}

export class SessionError extends Error {
  constructor(
    message: string,
    readonly status: 401 | 403,
  ) {
    super(message);
    this.name = "SessionError";
  }
}
