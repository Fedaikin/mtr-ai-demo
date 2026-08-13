import type { AgentExecutionContext, AgentContextSelection } from "@/domain/agent/context";
import type {
  AgentCitation,
  AgentEvidence,
  AgentEvidenceAvailability,
  AgentMissingData,
  NegativeEvidenceConclusion,
} from "@/domain/agent/evidence";
import type {
  TaskReviewPriority,
  TaskReviewStatus,
} from "@/domain/agent/task-review";
import type { PublicAnalyticalAnswer } from "@/domain/agent/analytics/answer";

export type {
  AgentCitation,
  AgentEvidence,
  AgentEvidenceAvailability,
  AgentMissingData,
} from "@/domain/agent/evidence";

export interface AgentPeriod {
  readonly from: string;
  readonly to: string;
}

/** Internal proof that a selection was reconciled with canonical request authorization. */
export interface ValidatedAgentSelection {
  readonly projectId: string;
  readonly specificationId?: string;
  readonly positionId?: string;
  readonly runId?: string;
  readonly period?: AgentPeriod;
  readonly validatedSubjectId: string;
  readonly validatedAgainstAuthorizationVersion: number;
  readonly validationRequestId: string;
}

export interface SummaryReadQuery {
  readonly selection: ValidatedAgentSelection;
}

export interface SummaryReadResult {
  readonly facts: readonly string[];
  readonly evidence: AgentEvidence;
}

export interface SummaryReadPort {
  read(context: AgentExecutionContext, query: SummaryReadQuery): Promise<SummaryReadResult>;
}

export interface PersonalTask {
  readonly id: string;
  readonly title: string;
  readonly status: TaskReviewStatus;
  readonly priority: TaskReviewPriority;
  readonly dueAt?: string | null;
}

export interface PersonalTaskQuery {
  readonly selection: ValidatedAgentSelection;
  readonly assigneeSubjectId: string;
  readonly statuses?: readonly TaskReviewStatus[];
  readonly priorities?: readonly TaskReviewPriority[];
}

export interface PersonalTaskReadPort {
  listMine(
    context: AgentExecutionContext,
    query: PersonalTaskQuery,
  ): Promise<{ readonly items: readonly PersonalTask[]; readonly evidence: AgentEvidence }>;
}

export const AGENT_RISK_LEVELS = ["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;
export type AgentRiskLevel = (typeof AGENT_RISK_LEVELS)[number];

export interface AgentRisk {
  readonly id: string;
  readonly level: AgentRiskLevel;
  readonly score: number;
  readonly horizonDays: number;
  readonly objectType: string;
  readonly objectId: string;
  readonly summary: string;
  readonly factors: readonly string[];
  readonly impact: string;
  readonly recommendedActions: readonly string[];
  readonly confidence: number;
  readonly ruleVersion: string;
  readonly requiresHumanReview: boolean;
}

export interface RiskEvaluationQuery {
  readonly selection: ValidatedAgentSelection;
  readonly levels?: readonly AgentRiskLevel[];
  readonly objectTypes?: readonly string[];
  readonly horizonDays?: number;
}

export interface RiskEvaluationPort {
  evaluate(
    context: AgentExecutionContext,
    query: RiskEvaluationQuery,
  ): Promise<{ readonly items: readonly AgentRisk[]; readonly evidence: AgentEvidence }>;
}

export interface AgentStockItem {
  readonly materialCode: string;
  readonly warehouseId: string;
  readonly availableQuantity: number;
  /** Null means the current repository source does not expose this dimension. */
  readonly reservedQuantity: number | null;
  /** Null means the current repository source does not expose this dimension. */
  readonly quarantinedQuantity: number | null;
  readonly unit: string;
  readonly snapshotAt: string;
}

export interface StockSearchQuery {
  readonly selection: ValidatedAgentSelection;
  readonly materialCode?: string;
  readonly query?: string;
  /** Mandatory pre-retrieval scope, including when the authorized scope is empty. */
  readonly warehouseIds: readonly string[];
}

export interface AgentStockReadPort {
  search(
    context: AgentExecutionContext,
    query: StockSearchQuery,
  ): Promise<{ readonly items: readonly AgentStockItem[]; readonly evidence: AgentEvidence }>;
}

export type KpiSourceKind = Extract<
  AgentCitation["sourceKind"],
  "MATERIAL_MOVEMENT" | "PROCESS_EVENT" | "TECHNICAL_SAMPLE" | "DEFINITION"
>;

export interface KpiDrillDownItem extends Omit<AgentCitation, "sourceKind"> {
  readonly sourceKind: KpiSourceKind;
}

export interface KpiMetric {
  readonly metricKey: string;
  /** Version of the formula/definition; it is not a source snapshot. */
  readonly definitionVersion: string;
  readonly formula: string;
  readonly period: AgentPeriod;
  readonly numerator: number;
  readonly denominator: number;
  readonly value: number;
  readonly unit: string;
  readonly target: number;
  readonly deviation: number;
  readonly trend: "UP" | "STABLE" | "DOWN" | "UNAVAILABLE";
  readonly availability: AgentEvidenceAvailability;
  readonly drillDown: readonly KpiDrillDownItem[];
}

export interface KpiCalculationQuery {
  readonly selection: ValidatedAgentSelection;
  readonly metricKeys?: readonly string[];
  /** Always constrained to the warehouse scope from canonical execution context. */
  readonly warehouseIds: readonly string[];
}

export interface KpiCalculationPort {
  calculate(
    context: AgentExecutionContext,
    query: KpiCalculationQuery,
  ): Promise<{ readonly metrics: readonly KpiMetric[]; readonly evidence: AgentEvidence }>;
}

export interface AnalyticalReadQuery {
  readonly selection: ValidatedAgentSelection;
  readonly positionId: string;
  readonly question: string;
  readonly horizonWeeks: number;
  readonly demandMultiplier?: number;
  readonly deliveryDelayDays?: number;
}

export interface AnalyticalReadPort {
  analyze(
    context: AgentExecutionContext,
    query: AnalyticalReadQuery,
  ): Promise<PublicAnalyticalAnswer>;
}

export interface AgentOrchestratorPorts {
  readonly summary: SummaryReadPort;
  readonly tasks: PersonalTaskReadPort;
  readonly risks: RiskEvaluationPort;
  readonly stocks: AgentStockReadPort;
  readonly metrics: KpiCalculationPort;
  readonly analytics?: AnalyticalReadPort;
}

interface CommandRequestBase<K extends string, F> {
  readonly commandKey: K;
  readonly context: AgentContextSelection;
  readonly filters?: F;
}

export type SummaryCommandRequest = CommandRequestBase<"SUMMARY", Record<never, never>>;
export type TasksCommandRequest = CommandRequestBase<
  "MY_TASKS",
  {
    readonly statuses?: readonly TaskReviewStatus[];
    readonly priorities?: readonly TaskReviewPriority[];
  }
>;
export type RisksCommandRequest = CommandRequestBase<
  "RISKS",
  {
    readonly levels?: readonly AgentRiskLevel[];
    readonly objectTypes?: readonly string[];
    readonly horizonDays?: number;
  }
>;
export type StocksCommandRequest = CommandRequestBase<
  "STOCKS",
  {
    readonly materialCode?: string;
    readonly query?: string;
    readonly warehouseIds?: readonly string[];
  }
>;
export type KpiCommandRequest = CommandRequestBase<
  "KPI",
  { readonly metricKeys?: readonly string[] }
>;
export type AnalysisCommandRequest = CommandRequestBase<
  "ANALYSIS",
  {
    readonly positionId?: string;
    readonly horizonWeeks?: number;
    readonly demandMultiplier?: number;
    readonly deliveryDelayDays?: number;
  }
>;

export interface AgentCommandRequestMap {
  readonly SUMMARY: SummaryCommandRequest;
  readonly MY_TASKS: TasksCommandRequest;
  readonly RISKS: RisksCommandRequest;
  readonly STOCKS: StocksCommandRequest;
  readonly KPI: KpiCommandRequest;
  readonly ANALYSIS: AnalysisCommandRequest;
}

export type AgentOrchestratorCommandRequest = AgentCommandRequestMap[keyof AgentCommandRequestMap];

interface AgentCommandResultBase<K extends keyof AgentCommandRequestMap> {
  readonly responseType: K;
  readonly title: string;
  readonly summary: string;
  readonly citations: readonly AgentCitation[];
  readonly missingData: readonly AgentMissingData[];
  readonly confidence: number;
  readonly requiresHumanReview: boolean;
  readonly negativeEvidence: NegativeEvidenceConclusion;
  readonly generatedAt: string;
}

export interface SummaryCommandResult extends AgentCommandResultBase<"SUMMARY"> {
  readonly facts: readonly string[];
}

export interface TasksCommandResult extends AgentCommandResultBase<"MY_TASKS"> {
  readonly items: readonly PersonalTask[];
}

export interface RisksCommandResult extends AgentCommandResultBase<"RISKS"> {
  readonly items: readonly AgentRisk[];
}

export interface StocksCommandResult extends AgentCommandResultBase<"STOCKS"> {
  readonly items: readonly AgentStockItem[];
}

export interface KpiCommandResult extends AgentCommandResultBase<"KPI"> {
  readonly metrics: readonly KpiMetric[];
}

export interface AnalysisCommandResult extends AgentCommandResultBase<"ANALYSIS"> {
  readonly analysis: PublicAnalyticalAnswer;
}

export interface AgentCommandResultMap {
  readonly SUMMARY: SummaryCommandResult;
  readonly MY_TASKS: TasksCommandResult;
  readonly RISKS: RisksCommandResult;
  readonly STOCKS: StocksCommandResult;
  readonly KPI: KpiCommandResult;
  readonly ANALYSIS: AnalysisCommandResult;
}

export type AgentOrchestratorCommandResult = AgentCommandResultMap[keyof AgentCommandResultMap];
