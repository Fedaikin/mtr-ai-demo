import { z } from "zod";

import { getRepository } from "@/adapters/persistence/repository";
import { ok, toErrorResponse } from "@/lib/api";
import { redactSensitiveRecord } from "@/lib/redaction";
import { requireAnyPermission } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const auditQuerySchema = z.object({
  action: z.string().trim().max(120).optional(),
  entityType: z.string().trim().max(120).optional(),
  outcome: z.enum(["SUCCESS", "FAILURE"]).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
  offset: z.coerce.number().int().min(0).default(0),
});

export async function GET(request: Request) {
  try {
    const [session, repository] = await Promise.all([
      requireAnyPermission(["audit.read.global", "audit.read.project"]),
      getRepository(),
    ]);
    const searchParams = new URL(request.url).searchParams;
    const query = auditQuerySchema.parse({
      action: searchParams.get("action") || undefined,
      entityType: searchParams.get("entityType") || undefined,
      outcome: searchParams.get("outcome") || undefined,
      limit: searchParams.get("limit") ?? undefined,
      offset: searchParams.get("offset") ?? undefined,
    });
    const entries = await repository.listAuditLogs(session.user.id, query);
    return ok({
      entries: entries.map((entry) => ({
        ...entry,
        details: redactSensitiveRecord(entry.details),
      })),
      pagination: { limit: query.limit, offset: query.offset, returned: entries.length },
      isSyntheticDemo: true,
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
