import { z } from "zod";

import { getRepository } from "@/adapters/persistence/repository";
import { ApiError, created, ok, parseJson, toErrorResponse } from "@/lib/api";
import { requirePermission } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const createPromptSchema = z
  .object({
    name: z.string().trim().min(1).max(80).default("mtr-project-agent"),
    promptVersion: z
      .string()
      .trim()
      .min(1)
      .max(32)
      .regex(/^[0-9A-Za-z][0-9A-Za-z._-]*$/, "Используйте буквы, цифры, точку, дефис или подчёркивание."),
    content: z.string().trim().min(40).max(20_000),
    activate: z.boolean().default(false),
  })
  .strict();

export async function GET() {
  try {
    const [session, repository] = await Promise.all([
      requirePermission("prompt.manage"),
      getRepository(),
    ]);
    return ok({ prompts: await repository.listPrompts(session.user.id), isSyntheticDemo: true });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const [session, repository, input] = await Promise.all([
      requirePermission("prompt.manage"),
      getRepository(),
      parseJson(request).then((body) => createPromptSchema.parse(body)),
    ]);
    const existing = await repository.listPrompts(session.user.id, input.name);
    if (existing.some((prompt) => prompt.promptVersion === input.promptVersion)) {
      throw new ApiError(409, "PROMPT_VERSION_EXISTS", "Версия промпта уже существует.");
    }
    const prompt = await repository.createPromptVersion(session.user.id, {
      name: input.name,
      promptVersion: input.promptVersion,
      content: input.content,
      active: input.activate,
    });
    await repository.writeAudit(session.user.id, {
      action: "ADMIN_PROMPT_VERSION_CREATED",
      entityType: "PROMPT_VERSION",
      entityId: prompt.id,
      outcome: "SUCCESS",
      details: {
        name: prompt.name,
        promptVersion: prompt.promptVersion,
        checksum: prompt.checksum,
        activated: prompt.active,
      },
    });
    return created({ prompt, isSyntheticDemo: true });
  } catch (error) {
    return toErrorResponse(error);
  }
}
