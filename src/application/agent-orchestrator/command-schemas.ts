import { z } from "zod";

import { AGENT_COMMAND_KEYS, type AgentCommandKey } from "@/domain/agent/commands";
import {
  TASK_REVIEW_PRIORITIES,
  TASK_REVIEW_STATUSES,
} from "@/domain/agent/task-review";

const periodSchema = z
  .object({ from: z.string().datetime(), to: z.string().datetime() })
  .strict()
  .refine((period) => Date.parse(period.from) < Date.parse(period.to), {
    message: "Начало периода должно быть раньше окончания",
  });

const contextSchema = z
  .object({
    projectId: z.string().trim().min(1).max(200).optional(),
    specificationId: z.string().trim().min(1).max(200).optional(),
    positionId: z.string().trim().min(1).max(200).optional(),
    runId: z.string().trim().min(1).max(200).optional(),
    period: periodSchema.optional(),
  })
  .strict()
  .default({});

const commandSchemas = {
  SUMMARY: z
    .object({
      context: contextSchema,
      filters: z.object({}).strict().optional(),
    })
    .strict(),
  MY_TASKS: z
    .object({
      context: contextSchema,
      filters: z
        .object({
          statuses: z.array(z.enum(TASK_REVIEW_STATUSES)).max(TASK_REVIEW_STATUSES.length).optional(),
          priorities: z
            .array(z.enum(TASK_REVIEW_PRIORITIES))
            .max(TASK_REVIEW_PRIORITIES.length)
            .optional(),
        })
        .strict()
        .optional(),
    })
    .strict(),
  RISKS: z
    .object({
      context: contextSchema,
      filters: z
        .object({
          levels: z.array(z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"])).max(4).optional(),
          objectTypes: z.array(z.string().trim().min(1).max(100)).max(20).optional(),
          horizonDays: z.number().int().min(1).max(365).optional(),
        })
        .strict()
        .optional(),
    })
    .strict(),
  STOCKS: z
    .object({
      context: contextSchema,
      filters: z
        .object({
          materialCode: z.string().trim().min(1).max(100).optional(),
          query: z.string().trim().min(1).max(200).optional(),
          warehouseIds: z.array(z.string().trim().min(1).max(100)).max(20).optional(),
        })
        .strict()
        .optional(),
    })
    .strict(),
  KPI: z
    .object({
      context: contextSchema,
      filters: z
        .object({
          metricKeys: z.array(z.string().trim().min(1).max(100)).max(30).optional(),
        })
        .strict()
        .optional(),
    })
    .strict(),
} satisfies Record<AgentCommandKey, z.ZodType>;

export type AgentCommandRequest = z.output<(typeof commandSchemas)[AgentCommandKey]> & {
  readonly commandKey: AgentCommandKey;
};

export function parseAgentCommandRequest(commandKey: string, body: unknown): AgentCommandRequest {
  if (!AGENT_COMMAND_KEYS.includes(commandKey as AgentCommandKey)) {
    throw new AgentCommandInputError("AGENT_COMMAND_NOT_FOUND");
  }
  const key = commandKey as AgentCommandKey;
  return { commandKey: key, ...commandSchemas[key].parse(body) } as AgentCommandRequest;
}

export class AgentCommandInputError extends Error {
  constructor(readonly code: "AGENT_COMMAND_NOT_FOUND") {
    super("Команда МТР-агента не найдена");
    this.name = "AgentCommandInputError";
  }
}
