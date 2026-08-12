import { getRepository } from "@/adapters/persistence/repository";
import { created, ok, parseJson, toErrorResponse } from "@/lib/api";
import { requireDemoRole } from "@/lib/session";

import { createThreadInputSchema, serializeAgentThread } from "../_shared";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const sessionPromise = requireDemoRole("USER");
    const repositoryPromise = getRepository();
    const [{ user }, repository] = await Promise.all([sessionPromise, repositoryPromise]);
    const threads = await repository.listAgentThreads(user.id);
    return ok(
      { items: threads.map(serializeAgentThread) },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const sessionPromise = requireDemoRole("USER");
    const repositoryPromise = getRepository();
    const bodyPromise = parseJson(request).then((body) => createThreadInputSchema.parse(body));
    const [{ user }, repository, body] = await Promise.all([
      sessionPromise,
      repositoryPromise,
      bodyPromise,
    ]);
    const thread = await repository.createAgentThread(user.id, body.title ?? "Новый диалог");
    await repository.writeAudit(user.id, {
      action: "agent.thread.created",
      entityType: "agent_thread",
      entityId: thread.id,
      outcome: "SUCCESS",
      details: { titleLength: thread.title.length },
    });
    return created({ thread: serializeAgentThread(thread) });
  } catch (error) {
    return toErrorResponse(error);
  }
}
