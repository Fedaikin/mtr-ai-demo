import { z } from "zod";

import { assignRole, revokeAssignment, setUserStatus } from "@/application/access-administration";
import { parseJson, toErrorResponse } from "@/lib/api";
import { requirePermission } from "@/lib/session";

const inputSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("status"), status: z.enum(["ACTIVE", "BLOCKED"]) }),
  z.object({ action: z.literal("assign"), roleKey: z.enum(["SYSTEM_ADMIN", "AUDITOR", "PROJECT_VIEWER", "MTR_ANALYST", "MTR_EXPERT", "PROJECT_MANAGER"]), projectId: z.string().nullable().optional(), validUntil: z.string().datetime().nullable().optional() }),
  z.object({ action: z.literal("revoke"), assignmentId: z.string().min(1) }),
]);

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const [{ user }, { id }, input] = await Promise.all([requirePermission("user.manage"), params, parseJson(request).then((value) => inputSchema.parse(value))]);
    const actorId = user.subjectId ?? user.id;
    if (input.action === "status") await setUserStatus(actorId, id, input.status);
    else if (input.action === "assign") await assignRole({ actorId, userId: id, roleKey: input.roleKey, projectId: input.projectId, validUntil: input.validUntil });
    else await revokeAssignment(actorId, input.assignmentId);
    return Response.json({ ok: true });
  } catch (error) {
    return toErrorResponse(error);
  }
}
