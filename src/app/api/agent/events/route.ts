import { createAgentEventStore } from "@/adapters/persistence/agent-event-store";
import { resolveServiceAuthorizationContext } from "@/application/authorization-service";
import { AgentEventService } from "@/application/agent-orchestrator/event-service";
import { created, parseJson } from "@/lib/api";

import {
  assertEventIngress,
  eventErrorResponse,
  eventIngressSchema,
  processEventById,
} from "./_shared";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    assertEventIngress(request);
    const input = eventIngressSchema.parse(await parseJson(request));
    const authorization = await resolveServiceAuthorizationContext("demo-service-001", input.projectId);
    const event = await new AgentEventService(await createAgentEventStore()).ingest(input, authorization);
    const insight = await processEventById(event);
    return created({
      event: { id: event.id, status: "PROCESSED", correlationId: event.correlationId },
      insight,
    });
  } catch (error) {
    return eventErrorResponse(error);
  }
}
