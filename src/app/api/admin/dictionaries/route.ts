import { z } from "zod";

import { getRepository } from "@/adapters/persistence/repository";
import { ok, toErrorResponse } from "@/lib/api";
import { requirePermission } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const querySchema = z.object({ q: z.string().trim().max(120).default("") });

export async function GET(request: Request) {
  try {
    const [session, repository] = await Promise.all([
      requirePermission("dictionary.manage"),
      getRepository(),
    ]);
    const query = querySchema.parse({ q: new URL(request.url).searchParams.get("q") ?? "" });
    const dictionaries = query.q
      ? await repository.searchDictionaries(session.user.id, query.q)
      : await repository.listDictionaries(session.user.id);
    return ok({ dictionaries, isSyntheticDemo: true });
  } catch (error) {
    return toErrorResponse(error);
  }
}
