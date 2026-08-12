"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";

export interface AdminScenarioState {
  id: string;
  name: string;
  enabled: boolean;
}

export function AdminScenarioToggle({
  initialScenarios,
}: {
  initialScenarios: AdminScenarioState[];
}) {
  const router = useRouter();
  const [scenarios, setScenarios] = useState(initialScenarios);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ tone: "success" | "error"; text: string } | null>(
    null,
  );
  const [isPending, startTransition] = useTransition();

  function toggleScenario(scenario: AdminScenarioState) {
    setPendingId(scenario.id);
    setFeedback(null);
    startTransition(async () => {
      try {
        const response = await fetch(`/api/admin/scenarios/${encodeURIComponent(scenario.id)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ enabled: !scenario.enabled }),
        });
        const payload = (await response.json()) as {
          scenario?: AdminScenarioState;
          error?: { message?: string };
        };
        if (!response.ok || !payload.scenario) {
          throw new Error(payload.error?.message ?? "Не удалось изменить состояние сценария.");
        }
        const updated = payload.scenario;
        setScenarios((current) =>
          current.map((item) => (item.id === updated.id ? { ...item, enabled: updated.enabled } : item)),
        );
        setFeedback({
          tone: "success",
          text: updated.enabled
            ? `Сценарий «${updated.name}» включён.`
            : `Сценарий «${updated.name}» отключён.`,
        });
        router.refresh();
      } catch (error) {
        setFeedback({
          tone: "error",
          text: error instanceof Error ? error.message : "Не удалось изменить состояние сценария.",
        });
      } finally {
        setPendingId(null);
      }
    });
  }

  return (
    <section
      className="mb-5 rounded-lg border border-slate-200 bg-white p-4 shadow-sm"
      aria-labelledby="scenario-access-title"
    >
      <div className="mb-3">
        <h2 id="scenario-access-title" className="text-sm font-semibold text-slate-900">
          Доступность сценариев
        </h2>
        <p className="mt-1 text-xs leading-5 text-slate-500">
          Отключённые сценарии сохраняются в базе и скрываются из формы нового запуска.
        </p>
      </div>
      <div className="grid gap-2 lg:grid-cols-2 xl:grid-cols-3">
        {scenarios.map((scenario) => (
          <div
            key={scenario.id}
            className="flex min-w-0 items-center justify-between gap-3 rounded-md border border-slate-200 px-3 py-2.5"
          >
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-slate-800">{scenario.name}</p>
              <p className={scenario.enabled ? "mt-0.5 text-xs text-emerald-700" : "mt-0.5 text-xs text-slate-500"}>
                {scenario.enabled ? "Включён" : "Отключён"}
              </p>
            </div>
            <Button
              type="button"
              size="sm"
              variant="outline"
              role="switch"
              aria-checked={scenario.enabled}
              aria-label={`Сценарий «${scenario.name}»`}
              disabled={isPending}
              onClick={() => toggleScenario(scenario)}
            >
              {pendingId === scenario.id
                ? "Сохраняем…"
                : scenario.enabled
                  ? "Отключить"
                  : "Включить"}
            </Button>
          </div>
        ))}
      </div>
      {feedback ? (
        <p
          role={feedback.tone === "error" ? "alert" : "status"}
          className={feedback.tone === "error" ? "mt-3 text-xs text-rose-700" : "mt-3 text-xs text-emerald-700"}
        >
          {feedback.text}
        </p>
      ) : null}
    </section>
  );
}
