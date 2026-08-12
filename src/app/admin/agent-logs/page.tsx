import type { Metadata } from "next";
import Link from "next/link";

import { getRepository } from "@/adapters/persistence/repository";
import {
  buildAgentObservabilityFromSummary,
  buildAgentOperations,
  type AgentOperationFilters,
} from "@/application/agent-observability";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import type { IntegrationSystem } from "@/domain/models";
import { formatDateTime } from "@/lib/format";
import {
  AGENT_LOG_UI_LABELS,
  auditOutcomeLabel,
  integrationStatusLabel,
  localizeKnownEnum,
} from "@/lib/localization";
import { safeAuditPreview } from "@/lib/redaction";
import { requireDemoRole } from "@/lib/session";

export const metadata: Metadata = { title: "Логи AI-агента" };
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface AgentLogSearchParams {
  from?: string | string[];
  to?: string | string[];
  user?: string | string[];
  scenario?: string | string[];
  tool?: string | string[];
  status?: string | string[];
  errorType?: string | string[];
  correlationId?: string | string[];
}

const SYSTEM_LABELS: Record<IntegrationSystem, string> = {
  APPIUS: "Appius PLM",
  SAP: "SAP S/4HANA",
  LLM: "LLM",
  RAG: "Нормативный поиск / RAG",
};

export default async function AdminAgentLogsPage({
  searchParams,
}: {
  searchParams: Promise<AgentLogSearchParams>;
}) {
  const [session, repository, rawQuery] = await Promise.all([
    requireDemoRole("ADMIN"),
    getRepository(),
    searchParams,
  ]);
  const filters = parseFilters(rawQuery);
  const [integrationStates, operationPage, runs, auditMetrics] = await Promise.all([
    repository.listIntegrationStates(session.user.id),
    repository.queryAgentAuditOperations(session.user.id, { ...filters, limit: 100 }),
    repository.listRuns(session.user.id, { limit: 200, includeSteps: false }),
    repository.getAgentAuditMetrics(session.user.id),
  ]);
  const metrics = buildAgentObservabilityFromSummary(auditMetrics, integrationStates, runs);
  const operations = buildAgentOperations(operationPage.entries);
  const statesBySystem = new Map(integrationStates.map((state) => [state.system, state]));

  return (
    <div className="space-y-6" data-testid="agent-logs-dashboard">
      <PageHeader
        eyebrow="Администрирование · наблюдаемость"
        title="Логи AI-агента"
        description="Рабочее состояние агента и безопасно очищенный журнал технических операций. Секреты, cookie, токены, пароли и полный текст документов не сохраняются."
      />

      <section aria-labelledby="agent-state-title">
        <h2 id="agent-state-title" className="mb-3 text-base font-semibold text-slate-950">
          Состояние агента
        </h2>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          <MetricCard label="Текущее состояние" value={agentStateLabel(metrics.agentState)} />
          {(["LLM", "APPIUS", "SAP", "RAG"] as const).map((system) => {
            const state = statesBySystem.get(system);
            return (
              <MetricCard
                key={system}
                label={SYSTEM_LABELS[system]}
                value={state ? integrationStatusLabel(state.state) : "Нет данных"}
                tone={state?.state === "AVAILABLE" ? "positive" : "warning"}
              />
            );
          })}
        </div>
      </section>

      <section aria-labelledby="agent-metrics-title">
        <h2 id="agent-metrics-title" className="mb-3 text-base font-semibold text-slate-950">
          Метрики запросов
        </h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6">
          <MetricCard label="Всего запросов" value={String(metrics.totalRequests)} />
          <MetricCard label="Успешные" value={String(metrics.successfulRequests)} tone="positive" />
          <MetricCard label="С ошибками" value={String(metrics.failedRequests)} tone="warning" />
          <MetricCard label="Среднее время" value={formatDuration(metrics.averageResponseMs)} />
          <MetricCard label="p50" value={formatDuration(metrics.p50ResponseMs)} />
          <MetricCard label="p95" value={formatDuration(metrics.p95ResponseMs)} />
          <MetricCard label="Вызовы инструментов" value={String(metrics.toolCalls)} />
          <MetricCard label="Повторные попытки" value={String(metrics.retries)} />
          <MetricCard label="Экспертная проверка" value={String(metrics.expertReviews)} />
          <MetricCard label="Активные сценарии" value={String(metrics.activeScenarios)} />
          <MetricCard label="Последний успех" value={formatOptionalDate(metrics.lastSuccessAt)} />
          <MetricCard label="Последний сбой" value={formatOptionalDate(metrics.lastFailureAt)} tone="warning" />
        </div>
      </section>

      <Card>
        <CardHeader className="border-b">
          <CardTitle>Фильтры журнала</CardTitle>
          <CardDescription>Фильтры применяются на сервере только к операциям текущего пользователя.</CardDescription>
        </CardHeader>
        <CardContent>
          <form method="get" action="/admin/agent-logs" className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <FilterInput label="Период с" name="from" type="date" value={filters.from} />
            <FilterInput label="Период по" name="to" type="date" value={filters.to} />
            <FilterInput label="Пользователь" name="user" value={filters.user} placeholder={session.user.displayName} />
            <FilterInput label="Сценарий / запуск" name="scenario" value={filters.scenario} placeholder="run-…" />
            <FilterInput label="Инструмент" name="tool" value={filters.tool} placeholder="sap.getMaterialStock" />
            <label className="block space-y-1.5 text-sm font-medium">
              <span>Статус</span>
              <select
                name="status"
                defaultValue={filters.status ?? ""}
                className="focus-ring h-8 w-full rounded-lg border border-slate-200 bg-white px-2.5 text-sm"
              >
                <option value="">Все</option>
                <option value="SUCCESS">Успешно</option>
                <option value="FAILURE">Ошибка</option>
              </select>
            </label>
            <FilterInput
              label="Тип ошибки"
              name="errorType"
              value={filters.errorType}
              placeholder={AGENT_LOG_UI_LABELS.errorTypePlaceholder}
            />
            <FilterInput label="Correlation ID" name="correlationId" value={filters.correlationId} placeholder="agent-…" />
            <div className="flex items-end gap-2 md:col-span-2 xl:col-span-4">
              <Button type="submit">Применить</Button>
              <Link href="/admin/agent-logs" className={buttonVariants({ variant: "outline" })}>
                Сбросить
              </Link>
            </div>
          </form>
        </CardContent>
      </Card>

      <section aria-labelledby="operations-title" className="space-y-3">
        <div>
          <h2 id="operations-title" className="text-base font-semibold text-slate-950">Журнал операций</h2>
          <p className="mt-1 text-sm text-slate-500">
            Найдено операций: {operationPage.total}. Показано: {operations.length}.
          </p>
        </div>
        {operations.map((operation) => (
          <Card key={operation.id} data-testid="agent-operation-card">
            <CardHeader className="border-b">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <CardTitle className="font-mono text-sm">{operation.tool}</CardTitle>
                  <CardDescription className="mt-1">
                    {formatDateTime(operation.occurredAt)} · {operation.actorDisplayName}
                  </CardDescription>
                </div>
                <Badge variant={operation.status === "SUCCESS" ? "secondary" : "destructive"}>
                  {auditOutcomeLabel(operation.status)}
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="grid gap-4 lg:grid-cols-3">
              <OperationField label="Диалог" value={operation.conversationId ?? "—"} mono />
              <OperationField label="Запуск" value={operation.runId ?? "—"} mono />
              <OperationField label="Correlation ID" value={operation.correlationId} mono />
              <OperationField label="Аргументы" value={localizedAuditPreview(operation.arguments)} mono />
              <OperationField label="Краткий результат" value={localizedAuditPreview(operation.result)} mono />
              <OperationField label="Объект" value={operation.entityId ?? "—"} mono />
              <OperationField label="Длительность" value={formatDuration(operation.durationMs)} />
              <OperationField label="Попытки" value={String(operation.attempts)} />
              <OperationField label="Prompt / модель" value={`${operation.promptVersion} · ${operation.model}`} />
              <OperationField
                label={AGENT_LOG_UI_LABELS.citations}
                value={operation.citations.length ? operation.citations.map(citationLabel).join("; ") : "—"}
              />
              <OperationField label="Код ошибки" value={operation.errorCode ?? "—"} mono />
              <OperationField label="Безопасное описание" value={operation.errorMessage ?? "—"} />
            </CardContent>
          </Card>
        ))}
        {operations.length === 0 ? (
          <Card><CardContent className="py-12 text-center text-sm text-slate-500">По выбранным фильтрам операций нет.</CardContent></Card>
        ) : null}
      </section>
    </div>
  );
}

function MetricCard({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: string;
  tone?: "neutral" | "positive" | "warning";
}) {
  const toneClass = tone === "positive" ? "text-emerald-700" : tone === "warning" ? "text-amber-800" : "text-slate-950";
  return (
    <Card>
      <CardContent className="py-4">
        <p className="text-xs text-slate-500">{label}</p>
        <p className={`mt-1 break-words text-lg font-semibold ${toneClass}`}>{value}</p>
      </CardContent>
    </Card>
  );
}

function FilterInput({
  label,
  name,
  value,
  type = "text",
  placeholder,
}: {
  label: string;
  name: string;
  value?: string;
  type?: string;
  placeholder?: string;
}) {
  return (
    <label className="block space-y-1.5 text-sm font-medium">
      <span>{label}</span>
      <Input name={name} type={type} defaultValue={value} placeholder={placeholder} />
    </label>
  );
}

function OperationField({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <p className="text-xs font-medium text-slate-500">{label}</p>
      <p className={`mt-1 break-words text-sm leading-5 text-slate-800 ${mono ? "font-mono text-xs" : ""}`}>{value}</p>
    </div>
  );
}

function parseFilters(raw: AgentLogSearchParams): AgentOperationFilters {
  const status = firstValue(raw.status);
  return {
    ...field(raw.from, "from", 10),
    ...field(raw.to, "to", 10),
    ...field(raw.user, "user", 160),
    ...field(raw.scenario, "scenario", 160),
    ...field(raw.tool, "tool", 160),
    ...(status === "SUCCESS" || status === "FAILURE" ? { status } : {}),
    ...field(raw.errorType, "errorType", 160),
    ...field(raw.correlationId, "correlationId", 160),
  };
}

function field<K extends keyof AgentOperationFilters>(
  value: string | string[] | undefined,
  key: K,
  maxLength: number,
): Partial<Pick<AgentOperationFilters, K>> {
  const parsed = firstValue(value).trim().slice(0, maxLength);
  return parsed ? ({ [key]: parsed } as Partial<Pick<AgentOperationFilters, K>>) : {};
}

function firstValue(value?: string | string[]): string {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

function agentStateLabel(value: "READY" | "PROCESSING" | "DEGRADED"): string {
  if (value === "PROCESSING") return "Выполняет сценарий";
  if (value === "DEGRADED") return "Работает с ограничениями";
  return "Готов к запросам";
}

function formatDuration(value: number | null): string {
  if (value === null) return "—";
  return value < 1_000 ? `${Math.round(value)} мс` : `${(value / 1_000).toFixed(2)} с`;
}

function formatOptionalDate(value: string | null): string {
  return value ? formatDateTime(value) : "—";
}

function citationLabel(citation: { sourceSystem: string; entityId: string; versionOrSnapshot: string; clauseId: string | null }): string {
  return `${citation.sourceSystem}: ${citation.entityId}, ${citation.versionOrSnapshot}${citation.clauseId ? `, п. ${citation.clauseId}` : ""}`;
}

function localizedAuditPreview(value: unknown): string {
  return safeAuditPreview(localizeAuditValue(value));
}

function localizeAuditValue(value: unknown): unknown {
  if (typeof value === "string") return localizeKnownEnum(value);
  if (Array.isArray(value)) return value.map(localizeAuditValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [key, localizeAuditValue(child)]),
    );
  }
  return value;
}
