"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

interface ResetCounts {
  canonicalPositions: number;
  sapMaterials: number;
  sapBalances: number;
}

export function AdminConfigReset({ available }: { available: boolean }) {
  const router = useRouter();
  const [confirmed, setConfirmed] = useState(false);
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<ResetCounts | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function reset() {
    setPending(true);
    setError(null);
    setResult(null);
    try {
      const response = await fetch("/api/admin/reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmation: "RESET_DEMO_DATA" }),
      });
      const payload = (await response.json()) as {
        counts?: ResetCounts;
        error?: { message?: string };
      };
      if (!response.ok || !payload.counts) {
        throw new Error(payload.error?.message ?? "Не удалось восстановить демонстрационные данные.");
      }
      setResult(payload.counts);
      setConfirmed(false);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Не удалось восстановить демонстрационные данные.");
    } finally {
      setPending(false);
    }
  }

  return (
    <Card className="border border-rose-200">
      <CardHeader className="border-b border-rose-100">
        <CardTitle>Сброс демонстрационного контура</CardTitle>
        <CardDescription>
          Восстанавливает исходные интеграции, промпт, словари, 24 позиции Appius и 30 остатков SAP.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {!available ? (
          <Alert variant="destructive">
            <AlertTitle>Сброс отключён</AlertTitle>
            <AlertDescription>Операция доступна только при APP_MODE=demo.</AlertDescription>
          </Alert>
        ) : null}
        <label className="flex max-w-2xl items-start gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={confirmed}
            disabled={!available || pending}
            onChange={(event) => setConfirmed(event.target.checked)}
            className="mt-0.5 size-4 accent-rose-700"
          />
          <span>Понимаю, что запуски, аудит и сделанные настройки будут заменены базовым демонстрационным набором.</span>
        </label>
        <Button
          type="button"
          variant="destructive"
          disabled={!available || !confirmed || pending}
          onClick={reset}
        >
          {pending ? "Восстанавливаем…" : "Восстановить базовый набор"}
        </Button>
        {result ? (
          <p role="status" className="text-sm text-emerald-700">
            Готово: Appius — {result.canonicalPositions}, SAP — {result.sapMaterials} материалов и {result.sapBalances} остатков.
          </p>
        ) : null}
        {error ? <p role="alert" className="text-sm text-rose-700">{error}</p> : null}
      </CardContent>
    </Card>
  );
}
