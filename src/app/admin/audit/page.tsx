import type { Metadata } from "next";

import { getRepository } from "@/adapters/persistence/repository";
import { AdminConfigReset } from "@/components/admin-config-reset";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/page-header";
import { formatDateTime } from "@/lib/format";
import {
  AUDIT_UI_LABELS,
  auditActionCode,
  auditActionLabel,
  auditEntityTypeCode,
  auditEntityTypeLabel,
  localizeAuditDetails,
} from "@/lib/localization";
import { safeAuditPreview } from "@/lib/redaction";
import { requireDemoRole } from "@/lib/session";

export const metadata: Metadata = { title: "Аудит" };
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface AuditSearchParams {
  action?: string | string[];
  entityType?: string | string[];
  outcome?: string | string[];
}

export default async function AdminAuditPage({
  searchParams,
}: {
  searchParams: Promise<AuditSearchParams>;
}) {
  const [session, repository, rawQuery] = await Promise.all([
    requireDemoRole("ADMIN"),
    getRepository(),
    searchParams,
  ]);
  const action = auditActionCode(firstValue(rawQuery.action).slice(0, 120));
  const entityType = auditEntityTypeCode(firstValue(rawQuery.entityType).slice(0, 120));
  const requestedOutcome = firstValue(rawQuery.outcome);
  const outcome = requestedOutcome === "SUCCESS" || requestedOutcome === "FAILURE" ? requestedOutcome : undefined;
  const entries = await repository.listAuditLogs(session.user.id, {
    ...(action ? { action } : {}),
    ...(entityType ? { entityType } : {}),
    ...(outcome ? { outcome } : {}),
    limit: 100,
  });

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Администрирование"
        title="Журнал аудита"
        description="Действия сценариев и администраторов для Демо-пользователя. Потенциально чувствительные поля скрываются перед выводом."
      />

      <Card>
        <CardHeader className="border-b">
          <CardTitle>Фильтры</CardTitle>
          <CardDescription>Укажите точное русское название действия или типа объекта.</CardDescription>
        </CardHeader>
        <CardContent>
          <form method="get" action="/admin/audit" className="grid gap-3 md:grid-cols-[1fr_1fr_180px_auto] md:items-end">
            <label className="block space-y-1.5 text-sm font-medium">
              <span>Действие</span>
              <Input
                name="action"
                defaultValue={action ? auditActionLabel(action) : ""}
                placeholder={AUDIT_UI_LABELS.actionPlaceholder}
              />
            </label>
            <label className="block space-y-1.5 text-sm font-medium">
              <span>Тип объекта</span>
              <Input
                name="entityType"
                defaultValue={entityType ? auditEntityTypeLabel(entityType) : ""}
                placeholder={AUDIT_UI_LABELS.entityTypePlaceholder}
              />
            </label>
            <label className="block space-y-1.5 text-sm font-medium">
              <span>Результат</span>
              <select
                name="outcome"
                defaultValue={outcome ?? ""}
                className="focus-ring h-8 w-full rounded-lg border border-slate-200 bg-white px-2.5 text-sm"
              >
                <option value="">Все</option>
                <option value="SUCCESS">Успех</option>
                <option value="FAILURE">Ошибка</option>
              </select>
            </label>
            <Button type="submit">Применить</Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="border-b">
          <CardTitle>События</CardTitle>
          <CardDescription>Последние {entries.length} записей, новые сверху.</CardDescription>
        </CardHeader>
        <CardContent className="px-0">
          <div className="data-table-scroll overflow-x-auto">
            <table className="w-full min-w-[900px] text-left text-sm">
              <thead className="border-b bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3 font-medium">Время</th>
                  <th className="px-4 py-3 font-medium">Действие</th>
                  <th className="px-4 py-3 font-medium">Объект</th>
                  <th className="px-4 py-3 font-medium">Результат</th>
                  <th className="px-4 py-3 font-medium">Детали</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {entries.map((entry) => (
                  <tr key={entry.id} className="align-top hover:bg-slate-50/70">
                    <td className="whitespace-nowrap px-4 py-3 text-slate-600">{formatDateTime(entry.occurredAt)}</td>
                    <td className="px-4 py-3 font-medium text-slate-900">{auditActionLabel(entry.action)}</td>
                    <td className="px-4 py-3 text-slate-600">
                      <span className="block">{auditEntityTypeLabel(entry.entityType)}</span>
                      <span className="block max-w-48 truncate text-xs text-slate-400">{entry.entityId ?? "—"}</span>
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant={entry.outcome === "SUCCESS" ? "secondary" : "destructive"}>
                        {entry.outcome === "SUCCESS" ? "Успех" : "Ошибка"}
                      </Badge>
                    </td>
                    <td className="max-w-md px-4 py-3 font-mono text-xs leading-5 text-slate-600">
                      {safeAuditPreview(localizeAuditDetails(entry.details))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {entries.length === 0 ? (
            <p className="px-4 py-10 text-center text-sm text-slate-500">По выбранным фильтрам событий нет.</p>
          ) : null}
        </CardContent>
      </Card>

      <AdminConfigReset available={isResetAvailable()} />
    </div>
  );
}

function firstValue(value?: string | string[]): string {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

function isResetAvailable(): boolean {
  const localDefault = process.env.NODE_ENV === "development" || process.env.NODE_ENV === "test";
  return (process.env.APP_MODE ?? (localDefault ? "demo" : "")) === "demo";
}
