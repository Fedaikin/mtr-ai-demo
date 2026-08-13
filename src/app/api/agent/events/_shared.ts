import { timingSafeEqual } from "node:crypto";

import { z } from "zod";

import { createAgentEventStore } from "@/adapters/persistence/agent-event-store";
import { getRepository } from "@/adapters/persistence/repository";
import { resolveServiceAuthorizationContext } from "@/application/authorization-service";
import { AgentEventService, AgentEventServiceError } from "@/application/agent-orchestrator/event-service";
import { readAgentFeaturePolicy } from "@/application/agent-orchestrator/feature-policy";
import { AGENT_PLATFORM_EVENT_TYPES } from "@/domain/agent/events";
import { ApiError, toErrorResponse } from "@/lib/api";

import { createMtrAgentOrchestrator } from "../_shared";

const payloadValueSchema = z.union([
  z.string().max(500),
  z.number(),
  z.boolean(),
  z.null(),
  z.array(z.string().max(240)).max(50),
]);

export const eventIngressSchema = z.object({
  sourceSystem: z.enum(["APPIUS", "SAP", "PROCESS_ENGINE", "RISK_ENGINE"]),
  sourceEventId: z.string().trim().min(1).max(240),
  eventType: z.enum(AGENT_PLATFORM_EVENT_TYPES),
  projectId: z.string().trim().min(1).max(200),
  entityId: z.string().trim().min(1).max(240),
  stateVersion: z.string().trim().min(1).max(240),
  occurredAt: z.string().datetime(),
  payload: z.record(z.string(), payloadValueSchema).optional(),
}).strict();

export const eventProcessSchema = z.object({
  projectId: z.string().trim().min(1).max(200).default("demo-project-001"),
}).strict();

export function assertEventIngress(request: Request): void {
  const policy = readAgentFeaturePolicy();
  if (!policy.eventsEnabled) {
    throw new ApiError(
      policy.executionAllowed ? 404 : 503,
      policy.executionAllowed ? "MTR_AGENT_EVENTS_DISABLED" : "MTR_AGENT_KILL_SWITCH_ACTIVE",
      "Событийный канал МТР-агента недоступен",
    );
  }
  const configured = process.env.MTR_AGENT_EVENT_INGRESS_SECRET;
  const supplied = request.headers.get("x-mtr-event-secret");
  if (!configured || configured.length < 32 || !supplied || !equalSecret(configured, supplied)) {
    throw new ApiError(401, "AGENT_EVENT_INGRESS_UNAUTHORIZED", "Требуется сервисная авторизация");
  }
}

export async function processEventById(
  event: { readonly id: string; readonly eventType: string; readonly entityId: string; readonly stateVersion: string; readonly occurredAt: string; readonly projectId: string; readonly correlationId: string },
) {
  const authorization = await resolveServiceAuthorizationContext("demo-service-001", event.projectId);
  const [store, repository] = await Promise.all([createAgentEventStore(), getRepository()]);
  const service = new AgentEventService(store);
  const orchestrator = createMtrAgentOrchestrator(repository, service);
  const result = await orchestrator.handle({
    kind: "EVENT",
    eventId: event.id,
    eventType: event.eventType,
    entityId: event.entityId,
    stateVersion: event.stateVersion,
    occurredAt: event.occurredAt,
    selection: { projectId: event.projectId },
    correlationId: event.correlationId,
  }, authorization);
  if (result.kind !== "EVENT") throw new Error("AGENT_EVENT_CHANNEL_RESULT_MISMATCH");
  return result.output;
}

export function eventErrorResponse(error: unknown) {
  if (error instanceof AgentEventServiceError) {
    const status = error.code.endsWith("DENIED") ? 403 : error.code === "AGENT_EVENT_QUEUE_EMPTY" ? 204 : 409;
    return toErrorResponse(new ApiError(status, error.code, error.message));
  }
  return toErrorResponse(error);
}

function equalSecret(expected: string, actual: string): boolean {
  const left = Buffer.from(expected, "utf8");
  const right = Buffer.from(actual, "utf8");
  return left.length === right.length && timingSafeEqual(left, right);
}
