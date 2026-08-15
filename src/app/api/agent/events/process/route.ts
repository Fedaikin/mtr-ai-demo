import { createAgentEventStore } from "@/adapters/persistence/agent-event-store";
import { ok, parseJson } from "@/lib/api";

import {
  assertEventIngress,
  eventErrorResponse,
  eventProcessSchema,
  processEventById,
} from "../_shared";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    assertEventIngress(request);
    const { projectId } = eventProcessSchema.parse(await parseJson(request));
    const event = await (await createAgentEventStore()).peekNext(projectId);
    if (!event) return ok({ processed: false });
    return ok({ processed: true, insight: await processEventById(event) });
  } catch (error) {
    return eventErrorResponse(error);
  }
}
