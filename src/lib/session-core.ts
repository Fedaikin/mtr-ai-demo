import "server-only";

import { createHmac, randomBytes, randomUUID } from "node:crypto";

import { initializeDatabase } from "@/adapters/persistence/bootstrap";
import { getRepository } from "@/adapters/persistence/repository";
import type { DemoUser } from "@/domain/models";
import { getConfiguredDemoPasswordHash, SESSION_MAX_AGE_SECONDS } from "@/lib/auth-config";
import { verifyPassword } from "@/lib/password";

const SESSION_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export interface PersistedDemoSession {
  id: string;
  user: DemoUser;
  expiresAt: string;
}

export interface CreatedDemoSession extends PersistedDemoSession {
  token: string;
}

export async function authenticateDemoCredentials(
  login: string,
  password: string,
): Promise<CreatedDemoSession | null> {
  await initializeDatabase();
  const repository = await getRepository();
  const user = await repository.findUserByLogin(login);
  const configuredHash = getConfiguredDemoPasswordHash();
  const passwordHash = configuredHash ?? user?.passwordHash;
  if (!user || !passwordHash || !(await verifyPassword(password, passwordHash))) return null;

  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_MAX_AGE_SECONDS * 1_000).toISOString();
  const session = await repository.createAuthSession({
    id: `session-${randomUUID()}`,
    userId: user.id,
    tokenHash: hashSessionToken(token),
    expiresAt,
  });
  return { ...session, token };
}

export async function resolveDemoSession(token: string | undefined): Promise<PersistedDemoSession | null> {
  if (!token || !SESSION_TOKEN_PATTERN.test(token)) return null;
  const repository = await getRepository();
  return repository.getAuthSessionByTokenHash(hashSessionToken(token));
}

export async function revokeDemoSession(token: string | undefined): Promise<void> {
  if (!token || !SESSION_TOKEN_PATTERN.test(token)) return;
  const repository = await getRepository();
  await repository.revokeAuthSession(hashSessionToken(token));
}

export function hashSessionToken(token: string): string {
  const credentialVersion = getConfiguredDemoPasswordHash() ?? "local-demo-session-v1";
  return createHmac("sha256", credentialVersion).update(token, "utf8").digest("hex");
}
