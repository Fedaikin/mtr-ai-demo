import { z } from "zod";

import { getRepository } from "@/adapters/persistence/repository";
import { ApiError, ok, toErrorResponse } from "@/lib/api";
import { requirePermission } from "@/lib/session";

export const runtime = "nodejs";

const idSchema = z.string().trim().min(1).max(160);

export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const [session, repository, params] = await Promise.all([
      requirePermission("prompt.activate"),
      getRepository(),
      context.params,
    ]);
    const promptId = idSchema.parse(params.id);
    const prompts = await repository.listPrompts(session.user.id);
    if (!prompts.some((prompt) => prompt.id === promptId)) {
      throw new ApiError(404, "PROMPT_NOT_FOUND", "Версия промпта не найдена.");
    }
    const prompt = await repository.activatePromptVersion(session.user.id, promptId);
    await repository.writeAudit(session.user.id, {
      action: "ADMIN_PROMPT_VERSION_ACTIVATED",
      entityType: "PROMPT_VERSION",
      entityId: prompt.id,
      outcome: "SUCCESS",
      details: { name: prompt.name, promptVersion: prompt.promptVersion, checksum: prompt.checksum },
    });
    return ok({ prompt, isSyntheticDemo: true });
  } catch (error) {
    return toErrorResponse(error);
  }
}
