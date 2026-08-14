import "server-only";

import type { MtrRepository } from "@/adapters/persistence/repository";
import type { UniversalResolvedContext } from "@/domain/agent/universal-chat/answer";
import type { UniversalChatMemory } from "@/application/agent-orchestrator/universal-chat/universal-chat-service";

export async function loadUniversalChatMemory(
  repository: MtrRepository,
  subjectId: string,
  threadId: string | undefined,
): Promise<UniversalChatMemory | null> {
  if (!threadId) return null;
  const messages = await repository.listAgentMessages(subjectId, threadId);
  for (const bundle of [...messages].reverse()) {
    if (bundle.message.role !== "assistant") continue;
    const record = asRecord(bundle.message.structuredOutput);
    if (record?.schemaVersion !== "universal-agent-answer-v1") continue;
    const output = asRecord(record.output);
    const resolvedContext = safeResolvedContext(asRecord(output?.resolvedContext));
    const risks = Array.isArray(output?.risks) ? output.risks : [];
    const shortageMaterialCodes = risks.flatMap((value) => {
      const risk = asRecord(value);
      return typeof risk?.materialCode === "string" && risk.id?.toString().startsWith("shortage-")
        ? [risk.materialCode]
        : [];
    });
    return {
      ...(resolvedContext ? { resolvedContext } : {}),
      ...(shortageMaterialCodes.length ? { shortageMaterialCodes } : {}),
    };
  }
  return null;
}

function safeResolvedContext(record: Record<string, unknown> | null): UniversalResolvedContext | undefined {
  if (!record) return undefined;
  const businessProject = safeEntityRef(asRecord(record.businessProject), "BUSINESS_PROJECT");
  const specification = safeEntityRef(asRecord(record.specification), "SPECIFICATION");
  const material = safeEntityRef(asRecord(record.material), "MATERIAL");
  const purpose = ["CONSTRUCTION", "MAINTENANCE", "REPAIR", "SPARES"].includes(String(record.purpose))
    ? record.purpose as UniversalResolvedContext["purpose"]
    : undefined;
  if (!businessProject && !specification && !material && !purpose) return undefined;
  return {
    ...(businessProject ? { businessProject } : {}),
    ...(specification ? { specification } : {}),
    ...(material ? { material } : {}),
    ...(purpose ? { purpose } : {}),
  };
}

function safeEntityRef(
  record: Record<string, unknown> | null,
  expectedKind: "BUSINESS_PROJECT" | "SPECIFICATION" | "MATERIAL",
) {
  if (
    !record ||
    record.kind !== expectedKind ||
    typeof record.id !== "string" ||
    typeof record.code !== "string" ||
    typeof record.name !== "string" ||
    typeof record.confidence !== "number"
  ) return undefined;
  return {
    kind: expectedKind,
    id: record.id,
    code: record.code,
    name: record.name,
    confidence: Math.max(0, Math.min(1, record.confidence)),
  } as const;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}
