import { z } from "zod";

import { getRepository, OptimisticLockError } from "@/adapters/persistence/repository";
import { ApiError, ok, parseJson, toErrorResponse } from "@/lib/api";
import { requireDemoRole } from "@/lib/session";

export const runtime = "nodejs";

const idSchema = z.string().trim().min(1).max(160);
const dictionaryUpdateSchema = z
  .object({
    values: z
      .array(z.string().trim().min(1).max(120))
      .min(1)
      .max(50)
      .transform((values) => [...new Set(values)]),
    active: z.boolean().optional(),
    version: z.number().int().positive(),
  })
  .strict();

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const [session, repository, input, params] = await Promise.all([
      requireDemoRole("ADMIN"),
      getRepository(),
      parseJson(request).then((body) => dictionaryUpdateSchema.parse(body)),
      context.params,
    ]);
    const dictionaryId = idSchema.parse(params.id);
    const dictionaries = await repository.listDictionaries(session.user.id);
    if (!dictionaries.some((dictionary) => dictionary.id === dictionaryId)) {
      throw new ApiError(404, "DICTIONARY_NOT_FOUND", "Словарь не найден.");
    }
    let dictionary;
    try {
      dictionary = await repository.updateDictionary(
        session.user.id,
        dictionaryId,
        { values: input.values, active: input.active },
        input.version,
      );
    } catch (error) {
      if (error instanceof OptimisticLockError) {
        throw new ApiError(409, "DICTIONARY_VERSION_CONFLICT", "Словарь уже изменён. Обновите страницу.");
      }
      throw error;
    }
    await repository.writeAudit(session.user.id, {
      action: "ADMIN_DICTIONARY_UPDATED",
      entityType: "DICTIONARY",
      entityId: dictionary.id,
      outcome: "SUCCESS",
      details: {
        dictionaryType: dictionary.dictionaryType,
        key: dictionary.key,
        valueCount: dictionary.values.length,
      },
    });
    return ok({ dictionary, isSyntheticDemo: true });
  } catch (error) {
    return toErrorResponse(error);
  }
}
