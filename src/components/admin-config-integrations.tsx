"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import type { IntegrationStatus, IntegrationSystem } from "@/domain/models";
import { formatDateTime } from "@/lib/format";
import { integrationStatusLabel, integrationSystemLabel } from "@/lib/localization";

export interface AdminIntegrationView {
  system: IntegrationSystem;
  state: IntegrationStatus;
  delayMs: number;
  snapshotAt: string | null;
  lastSynchronizedAt: string | null;
  safeMessage: string | null;
  version: number;
}

const STATES_BY_SYSTEM: Record<IntegrationSystem, IntegrationStatus[]> = {
  APPIUS: ["AVAILABLE", "UNAVAILABLE", "SLOW", "ACCESS_DENIED", "STALE_VERSION"],
  SAP: ["AVAILABLE", "UNAVAILABLE", "SLOW", "STALE", "RATE_LIMITED", "MALFORMED_RESPONSE"],
  RAG: ["AVAILABLE", "UNAVAILABLE", "SLOW", "RATE_LIMITED", "MALFORMED_RESPONSE"],
  LLM: ["AVAILABLE", "UNAVAILABLE", "SLOW", "RATE_LIMITED", "MALFORMED_RESPONSE"],
};

export function AdminConfigIntegrations({
  initialIntegrations,
}: {
  initialIntegrations: AdminIntegrationView[];
}) {
  const router = useRouter();
  const [integrations, setIntegrations] = useState(initialIntegrations);

  function replaceIntegration(next: AdminIntegrationView) {
    setIntegrations((current) => current.map((item) => (item.system === next.system ? next : item)));
    router.refresh();
  }

  return (
    <div className="grid gap-4 xl:grid-cols-2">
      {integrations.map((integration) => (
        <IntegrationEditor
          key={integration.system}
          integration={integration}
          onSaved={replaceIntegration}
        />
      ))}
    </div>
  );
}

function IntegrationEditor({
  integration,
  onSaved,
}: {
  integration: AdminIntegrationView;
  onSaved: (integration: AdminIntegrationView) => void;
}) {
  const [state, setState] = useState<IntegrationStatus>(integration.state);
  const [delayMs, setDelayMs] = useState(String(integration.delayMs));
  const [safeMessage, setSafeMessage] = useState(integration.safeMessage ?? "");
  const [snapshotAt, setSnapshotAt] = useState(toLocalDateTime(integration.snapshotAt));
  const [pending, setPending] = useState(false);
  const [feedback, setFeedback] = useState<{ tone: "success" | "error"; text: string } | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setFeedback(null);
    try {
      const response = await fetch("/api/admin/integrations", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          system: integration.system,
          state,
          delayMs: Number(delayMs),
          safeMessage: safeMessage.trim() || null,
          ...(integration.system === "SAP"
            ? { snapshotAt: snapshotAt ? new Date(snapshotAt).toISOString() : null }
            : {}),
        }),
      });
      const payload = await readJson<{
        integration: AdminIntegrationView;
        error?: { message?: string };
      }>(response);
      onSaved(payload.integration);
      setFeedback({ tone: "success", text: "Настройка сохранена и записана в аудит." });
    } catch (error) {
      setFeedback({ tone: "error", text: errorMessage(error) });
    } finally {
      setPending(false);
    }
  }

  return (
    <Card>
      <CardHeader className="border-b">
        <CardTitle>{integrationSystemLabel(integration.system)}</CardTitle>
        <CardDescription>
          Версия настройки {integration.version} · синхронизация {formatDateTime(integration.lastSynchronizedAt)}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form className="space-y-4" data-testid={`integration-${integration.system.toLowerCase()}`} onSubmit={submit}>
          <label className="block space-y-1.5 text-sm font-medium">
            <span>Состояние</span>
            <select
              value={state}
              onChange={(event) => setState(event.target.value as IntegrationStatus)}
              className="focus-ring h-9 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm"
            >
              {STATES_BY_SYSTEM[integration.system].map((value) => (
                <option key={value} value={value}>
                  {integrationStatusLabel(value)}
                </option>
              ))}
            </select>
          </label>
          <label className="block space-y-1.5 text-sm font-medium">
            <span>Задержка ответа, мс</span>
            <Input
              type="number"
              min={0}
              max={10_000}
              step={100}
              value={delayMs}
              onChange={(event) => setDelayMs(event.target.value)}
              required
            />
          </label>
          {integration.system === "SAP" && state === "STALE" ? (
            <label className="block space-y-1.5 text-sm font-medium">
              <span>Дата устаревшего снимка</span>
              <Input
                type="datetime-local"
                value={snapshotAt}
                onChange={(event) => setSnapshotAt(event.target.value)}
                required
              />
            </label>
          ) : null}
          <label className="block space-y-1.5 text-sm font-medium">
            <span>Безопасное сообщение пользователю</span>
            <Input
              value={safeMessage}
              maxLength={240}
              onChange={(event) => setSafeMessage(event.target.value)}
              placeholder="Например: система временно недоступна"
            />
          </label>
          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" disabled={pending}>
              {pending ? "Сохраняем…" : "Сохранить"}
            </Button>
            {feedback ? (
              <p
                role="status"
                className={feedback.tone === "success" ? "text-xs text-emerald-700" : "text-xs text-rose-700"}
              >
                {feedback.text}
              </p>
            ) : null}
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

async function readJson<T extends { error?: { message?: string } }>(response: Response): Promise<T> {
  const payload = (await response.json()) as T;
  if (!response.ok) throw new Error(payload.error?.message ?? "Не удалось сохранить настройку.");
  return payload;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Не удалось сохранить настройку.";
}

function toLocalDateTime(value: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return "";
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.valueOf() - offset).toISOString().slice(0, 16);
}
