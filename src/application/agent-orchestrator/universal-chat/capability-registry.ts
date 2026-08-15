import { z } from "zod";

import type { AgentExecutionContext } from "@/domain/agent/context";
import type { PermissionKey } from "@/domain/rbac";
import {
  createSourceBinding,
  type SourceBindingEnvelope,
} from "@/application/agent-orchestrator/universal-chat/source-binding";

const boundedText = z.string().trim().min(1).max(240);
const optionalLimit = z.number().int().min(1).max(200).optional();

export const UNIVERSAL_READ_CAPABILITY_SCHEMAS = {
  "project.search": z.object({ query: boundedText, limit: optionalLimit }).strict(),
  "project.get": z.object({ projectId: boundedText }).strict(),
  "project.list": z.object({ status: z.array(z.enum(["PLANNED", "ACTIVE", "ON_HOLD", "COMPLETED"])).max(4).optional(), limit: optionalLimit }).strict(),
  "project.getState": z.object({ projectId: boundedText }).strict(),
  "project.listDeadlines": z.object({ projectId: boundedText.optional(), dueBefore: z.string().datetime().optional(), limit: optionalLimit }).strict(),
  "project.listSpecifications": z.object({ projectId: boundedText, purpose: z.enum(["CONSTRUCTION", "MAINTENANCE", "REPAIR", "SPARES"]).optional(), limit: optionalLimit }).strict(),
  "project.listMaterials": z.object({ projectId: boundedText, equipmentType: boundedText.optional(), limit: optionalLimit }).strict(),
  "project.getMaterialCoverage": z.object({ projectId: boundedText, materialCode: boundedText.optional(), equipmentType: boundedText.optional(), limit: optionalLimit }).strict(),
  "project.getRisks": z.object({ projectId: boundedText }).strict(),
  "project.getKpiSla": z.object({ projectId: boundedText, asOf: z.string().datetime() }).strict(),
  "specification.search": z.object({ query: boundedText, projectId: boundedText.optional(), limit: optionalLimit }).strict(),
  "specification.getCurrentVersion": z.object({ specificationId: boundedText, includePrevious: z.boolean().default(true) }).strict(),
  "specification.getPositions": z.object({ specificationId: boundedText, equipmentType: boundedText.optional(), limit: optionalLimit }).strict(),
  "specification.getWhereUsed": z.object({ specificationId: boundedText }).strict(),
  "specification.countReceived": z.object({ from: z.string().datetime(), to: z.string().datetime(), projectId: boundedText.optional() }).strict(),
  "specification.getProcessingQueue": z.object({ projectId: boundedText.optional(), limit: optionalLimit }).strict(),
  "specification.getStatusBreakdown": z.object({ from: z.string().datetime(), to: z.string().datetime(), projectId: boundedText.optional() }).strict(),
  "specification.getSlaBreaches": z.object({ projectId: boundedText.optional(), asOf: z.string().datetime(), limit: optionalLimit }).strict(),
  "material.search": z.object({ query: boundedText, equipmentType: boundedText.optional(), limit: optionalLimit }).strict(),
  "material.get": z.object({ materialCode: boundedText }).strict(),
  "material.getStock": z.object({ materialCode: boundedText }).strict(),
  "material.getMovements": z.object({ materialCode: boundedText, weeks: z.number().int().min(1).max(52).default(13) }).strict(),
  "material.getInbound": z.object({ materialCode: boundedText }).strict(),
  "material.getReservations": z.object({ materialCode: boundedText }).strict(),
  "material.getWhereUsed": z.object({ materialCode: boundedText, limit: optionalLimit }).strict(),
  "material.forecastExhaustion": z.object({ materialCode: boundedText, horizonDays: z.number().int().min(1).max(365).default(30) }).strict(),
  "catalog.getBom": z.object({ materialCode: boundedText }).strict(),
  "catalog.getSubstitutes": z.object({ materialCode: boundedText, limit: optionalLimit }).strict(),
  "compatibility.evaluate": z.object({ sourceMaterialCode: boundedText, candidateMaterialCode: boundedText, requiredQuantity: z.number().positive() }).strict(),
  "reliability.compare": z.object({ sourceMaterialCode: boundedText, candidateMaterialCode: boundedText, operatingHours: z.number().positive().max(1_000_000) }).strict(),
  "analysis.projectSummary": z.object({ projectId: boundedText }).strict(),
  "analysis.rootCause": z.object({ projectId: boundedText, materialCode: boundedText.optional() }).strict(),
  "analysis.forecast": z.object({ projectId: boundedText.optional(), materialCode: boundedText.optional(), horizonDays: z.number().int().min(1).max(365).default(30) }).strict()
    .refine((value) => Boolean(value.projectId || value.materialCode), "projectId or materialCode is required"),
  "analysis.compareScenarios": z.object({ projectId: boundedText, delayedInboundDays: z.number().int().min(1).max(180).default(14) }).strict(),
  "analysis.reorderRecommendations": z.object({ projectId: boundedText, equipmentType: boundedText.optional(), limit: optionalLimit }).strict(),
  "analysis.replacementRecommendations": z.object({ projectId: boundedText, materialCode: boundedText.optional(), limit: optionalLimit }).strict(),
  "process.getQueue": z.object({ projectId: boundedText.optional(), limit: optionalLimit }).strict(),
  "process.getRuns": z.object({ projectId: boundedText.optional(), status: z.array(boundedText).max(10).optional(), limit: optionalLimit }).strict(),
  "task.listMine": z.object({ status: z.array(boundedText).max(10).optional(), limit: optionalLimit }).strict(),
  "task.listProject": z.object({ projectId: boundedText, status: z.array(boundedText).max(10).optional(), limit: optionalLimit }).strict(),
  "deadline.listUpcoming": z.object({ projectId: boundedText.optional(), withinDays: z.number().int().min(1).max(365).default(3), limit: optionalLimit }).strict(),
} as const;

export type UniversalReadCapabilityKey = keyof typeof UNIVERSAL_READ_CAPABILITY_SCHEMAS;
export type UniversalCapabilityInput<K extends UniversalReadCapabilityKey> = z.output<
  (typeof UNIVERSAL_READ_CAPABILITY_SCHEMAS)[K]
>;

export interface UniversalCapabilityDefinition<K extends UniversalReadCapabilityKey> {
  readonly key: K;
  readonly requiredPermissions: readonly PermissionKey[];
  readonly timeoutMs: number;
  readonly maxPagination: number;
  readonly resourceScope: "ACCESS_PROJECT" | "BUSINESS_PROJECT" | "CATALOG_SOURCE" | "PERSONAL";
  readonly completeness: "PORT_ENFORCED";
  readonly freshness: "SOURCE_SNAPSHOT" | "REQUEST_TIME";
  readonly citations: "REQUIRED_FOR_FACTS";
  readonly safeErrorCodes: readonly string[];
  readonly execute: (
    context: AgentExecutionContext,
    input: UniversalCapabilityInput<K>,
  ) => Promise<unknown>;
}

export type UniversalCapabilityManifestEntry = Readonly<Omit<
  UniversalCapabilityDefinition<UniversalReadCapabilityKey>,
  "execute"
>>;

export interface UniversalCapabilityAuditPort {
  write(
    context: AgentExecutionContext,
    event: Readonly<{
      capabilityKey: UniversalReadCapabilityKey;
      outcome: "SUCCESS" | "FAILURE";
      durationMs: number;
      safeErrorCode?: string;
      sourceBinding?: SourceBindingEnvelope;
    }>,
  ): Promise<void>;
}

export interface UniversalCapabilityRemoteExecutor {
  execute<K extends UniversalReadCapabilityKey>(
    key: K,
    context: AgentExecutionContext,
    input: UniversalCapabilityInput<K>,
  ): Promise<unknown>;
}

export class UniversalCapabilityRegistry {
  private readonly definitions = new Map<UniversalReadCapabilityKey, UniversalCapabilityDefinition<UniversalReadCapabilityKey>>();

  constructor(
    private readonly audit?: UniversalCapabilityAuditPort,
    private readonly remote?: UniversalCapabilityRemoteExecutor,
  ) {}

  register<K extends UniversalReadCapabilityKey>(definition: UniversalCapabilityDefinition<K>): void {
    if (this.definitions.has(definition.key)) throw new Error(`UNIVERSAL_CAPABILITY_DUPLICATE:${definition.key}`);
    this.definitions.set(
      definition.key,
      definition as UniversalCapabilityDefinition<UniversalReadCapabilityKey>,
    );
  }

  async execute<K extends UniversalReadCapabilityKey>(
    key: K,
    context: AgentExecutionContext,
    rawInput: unknown,
  ): Promise<unknown> {
    const startedAt = performance.now();
    const definition = this.definitions.get(key);
    if (!definition) {
      const error = new UniversalCapabilityError("UNIVERSAL_CAPABILITY_NOT_REGISTERED");
      await this.writeAudit(context, key, "FAILURE", startedAt, error.code);
      throw error;
    }
    for (const permission of definition.requiredPermissions) {
      if (!context.trusted.permissionKeys.has(permission)) {
        const error = new UniversalCapabilityError("UNIVERSAL_CAPABILITY_FORBIDDEN");
        await this.writeAudit(context, key, "FAILURE", startedAt, error.code);
        throw error;
      }
    }
    try {
      const input = UNIVERSAL_READ_CAPABILITY_SCHEMAS[key].parse(rawInput) as UniversalCapabilityInput<K>;
      const output = await withTimeout(
        this.remote
          ? this.remote.execute(key, context, input)
          : definition.execute(context, input as never),
        definition.timeoutMs,
      );
      await this.writeAudit(context, key, "SUCCESS", startedAt, undefined, input, output);
      return output;
    } catch (error) {
      await this.writeAudit(context, key, "FAILURE", startedAt, safeErrorCode(error));
      throw error;
    }
  }

  keys(): readonly UniversalReadCapabilityKey[] {
    return Object.freeze([...this.definitions.keys()].sort());
  }

  manifest(): readonly UniversalCapabilityManifestEntry[] {
    return Object.freeze([...this.definitions.values()]
      .sort((left, right) => left.key.localeCompare(right.key, "en"))
      .map((definition) => {
        const { execute, ...entry } = definition;
        void execute;
        return Object.freeze(entry);
      }));
  }

  private async writeAudit(
    context: AgentExecutionContext,
    capabilityKey: UniversalReadCapabilityKey,
    outcome: "SUCCESS" | "FAILURE",
    startedAt: number,
    safeErrorCode?: string,
    input?: unknown,
    output?: unknown,
  ): Promise<void> {
    if (!this.audit) return;
    await this.audit.write(context, {
      capabilityKey,
      outcome,
      durationMs: Math.max(0, Math.round((performance.now() - startedAt) * 100) / 100),
      ...(safeErrorCode ? { safeErrorCode } : {}),
      ...(input !== undefined && output !== undefined ? {
        sourceBinding: createSourceBinding({
          capabilityKey,
          requestId: context.correlationId,
          subjectId: context.trusted.subjectId,
          connector: connectorForCapability(capabilityKey),
          resultStatus: "SUCCESS",
          deploymentSha: process.env.FASTGATE_DEPLOYMENT_SHA ?? process.env.VERCEL_GIT_COMMIT_SHA ?? "LOCAL_UNATTESTED",
          datasetFingerprint: process.env.FASTGATE_DATASET_FINGERPRINT ?? "DATASET_UNATTESTED",
          input,
          output,
          privateKey: process.env.FASTGATE_SOURCE_BINDING_PRIVATE_KEY,
          publicKey: process.env.FASTGATE_SOURCE_BINDING_PUBLIC_KEY,
        }),
      } : {}),
    });
  }
}

function connectorForCapability(key: UniversalReadCapabilityKey): SourceBindingEnvelope["connector"] {
  if (key.startsWith("project.") || key.startsWith("specification.")) return "APPIUS";
  if (key.startsWith("material.") || key.startsWith("catalog.")) return "SAP";
  if (key.startsWith("compatibility.") || key.startsWith("reliability.")) return "NORMATIVE";
  return "PROCESS_ENGINE";
}

export class UniversalCapabilityError extends Error {
  constructor(
    readonly code:
      | "UNIVERSAL_CAPABILITY_NOT_REGISTERED"
      | "UNIVERSAL_CAPABILITY_FORBIDDEN"
      | "UNIVERSAL_CAPABILITY_TIMEOUT",
  ) {
    super("Универсальная возможность МТР-агента недоступна");
    this.name = "UniversalCapabilityError";
  }
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(
          () => reject(new UniversalCapabilityError("UNIVERSAL_CAPABILITY_TIMEOUT")),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function safeErrorCode(error: unknown): string {
  if (error instanceof UniversalCapabilityError) return error.code;
  if (error && typeof error === "object" && "name" in error && error.name === "ZodError") {
    return "UNIVERSAL_CAPABILITY_VALIDATION_FAILED";
  }
  return "UNIVERSAL_CAPABILITY_EXECUTION_FAILED";
}
