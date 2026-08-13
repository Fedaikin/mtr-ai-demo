import { z } from "zod";

import { assignRole, revokeAssignment, setProjectMembership } from "@/application/access-administration";
import { parseJson, toErrorResponse } from "@/lib/api";
import { requirePermission } from "@/lib/session";

const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("membership"), status: z.enum(["ACTIVE", "SUSPENDED"]) }),
  z.object({ action: z.literal("assign"), roleKey: z.enum(["PROJECT_VIEWER", "MTR_ANALYST", "MTR_EXPERT", "PROJECT_MANAGER"]) }),
  z.object({ action: z.literal("revoke"), assignmentId: z.string().min(1) }),
]);

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string; userId: string }> }) {
  try {
    const [{ id, userId }, session, input] = await Promise.all([params, requirePermission("project.members.manage"), parseJson(request).then((value) => schema.parse(value))]);
    const actorId = session.user.subjectId ?? session.user.id;
    if (input.action === "membership") await setProjectMembership({ actorId, projectId: id, userId, status: input.status });
    else if (input.action === "assign") await assignRole({ actorId, userId, projectId: id, roleKey: input.roleKey });
    else await revokeAssignment(actorId, input.assignmentId);
    return Response.json({ ok: true });
  } catch (error) { return toErrorResponse(error); }
}
