export const AGENT_PLATFORM_EVENT_TYPES = [
  "APPIUS_VERSION_PUBLISHED",
  "SAP_SNAPSHOT_RECEIVED",
  "RISK_LEVEL_RAISED",
  "DUE_DATE_APPROACHING",
  "SLA_BREACHED",
  "SCENARIO_COMPLETED",
  "SCENARIO_FAILED",
  "INTEGRATION_RECOVERED",
] as const;

export type AgentPlatformEventType = (typeof AGENT_PLATFORM_EVENT_TYPES)[number];
export type AgentEventSourceSystem = "APPIUS" | "SAP" | "PROCESS_ENGINE" | "RISK_ENGINE";
export type AgentEventInboxStatus = "PENDING" | "PROCESSING" | "PROCESSED" | "FAILED" | "DEAD_LETTER";

export interface AgentPlatformEvent {
  readonly sourceSystem: AgentEventSourceSystem;
  readonly sourceEventId: string;
  readonly eventType: AgentPlatformEventType;
  readonly projectId: string;
  readonly entityId: string;
  readonly stateVersion: string;
  readonly occurredAt: string;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly idempotencyKey: string;
  readonly correlationId: string;
}

export interface AgentEventInboxRecord extends AgentPlatformEvent {
  readonly id: string;
  readonly tenantId: string;
  readonly actorSubjectId: string | null;
  readonly status: AgentEventInboxStatus;
  readonly attempts: number;
  readonly maxAttempts: number;
  readonly availableAt: string;
  readonly receivedAt: string;
  readonly processedAt: string | null;
  readonly safeErrorCode: string | null;
  readonly authorizationVersion: number | null;
  readonly roleAssignmentSnapshot: readonly string[];
  readonly version: number;
}

export type AgentInsightLevel = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
export type AgentInsightStatus = "ACTIVE" | "ACKNOWLEDGED" | "RESOLVED" | "EXPIRED" | "SUPPRESSED";

export interface AgentProactiveInsightRecord {
  readonly id: string;
  readonly tenantId: string;
  readonly projectId: string;
  readonly caseId: string | null;
  readonly subjectUserId: string | null;
  readonly triggerType: AgentPlatformEventType;
  readonly stateVersion: string;
  readonly level: AgentInsightLevel;
  readonly status: AgentInsightStatus;
  readonly targetType: string;
  readonly targetId: string;
  readonly title: string;
  readonly summary: string;
  readonly recommendedAction: string;
  readonly evidenceFactIds: readonly string[];
  readonly deduplicationKey: string;
  readonly ruleVersion: string;
  readonly firstSeenAt: string;
  readonly lastSeenAt: string;
  readonly cooldownUntil: string | null;
  readonly expiresAt: string | null;
  readonly authorizationVersion: number;
  readonly roleAssignmentSnapshot: readonly string[];
  readonly createdBySubjectId: string | null;
  readonly version: number;
}

export interface PublicAgentProactiveInsight {
  readonly id: string;
  readonly level: AgentInsightLevel;
  readonly status: AgentInsightStatus;
  readonly targetType: string;
  readonly targetId: string;
  readonly title: string;
  readonly summary: string;
  readonly recommendedAction: string;
  readonly firstSeenAt: string;
  readonly lastSeenAt: string;
  readonly ruleVersion: string;
}
