"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { formatDateTime } from "@/lib/format";

export interface AdminPromptView {
  id: string;
  name: string;
  promptVersion: string;
  content: string;
  active: boolean;
  checksum: string;
  createdAt: string;
  version: number;
}

export function AdminConfigPrompts({ initialPrompts }: { initialPrompts: AdminPromptView[] }) {
  const router = useRouter();
  const activePrompt = initialPrompts.find((prompt) => prompt.active);
  const [prompts, setPrompts] = useState(() => sortPrompts(initialPrompts));
  const [promptVersion, setPromptVersion] = useState("");
  const [content, setContent] = useState(activePrompt?.content ?? "");
  const [activate, setActivate] = useState(true);
  const [pending, setPending] = useState(false);
  const [activatingId, setActivatingId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ tone: "success" | "error"; text: string } | null>(null);

  async function createVersion(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setFeedback(null);
    try {
      const response = await fetch("/api/admin/prompts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: activePrompt?.name ?? "mtr-project-agent",
          promptVersion,
          content,
          activate,
        }),
      });
      const payload = await readJson<{ prompt: AdminPromptView; error?: { message?: string } }>(response);
      setPrompts((current) =>
        sortPrompts([
          payload.prompt,
          ...current.map((prompt) =>
            payload.prompt.active && prompt.name === payload.prompt.name
              ? { ...prompt, active: false }
              : prompt,
          ),
        ]),
      );
      setPromptVersion("");
      setFeedback({ tone: "success", text: "Версия создана и записана в аудит." });
      router.refresh();
    } catch (error) {
      setFeedback({ tone: "error", text: errorMessage(error) });
    } finally {
      setPending(false);
    }
  }

  async function activateVersion(promptId: string) {
    setActivatingId(promptId);
    setFeedback(null);
    try {
      const response = await fetch(`/api/admin/prompts/${encodeURIComponent(promptId)}/activate`, {
        method: "POST",
      });
      const payload = await readJson<{ prompt: AdminPromptView; error?: { message?: string } }>(response);
      setPrompts((current) =>
        sortPrompts(
          current.map((prompt) => ({
            ...prompt,
            active: prompt.name === payload.prompt.name ? prompt.id === payload.prompt.id : prompt.active,
            ...(prompt.id === payload.prompt.id ? payload.prompt : {}),
          })),
        ),
      );
      setContent(payload.prompt.content);
      setFeedback({ tone: "success", text: `Активирована версия ${payload.prompt.promptVersion}.` });
      router.refresh();
    } catch (error) {
      setFeedback({ tone: "error", text: errorMessage(error) });
    } finally {
      setActivatingId(null);
    }
  }

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(360px,0.72fr)]">
      <Card>
        <CardHeader className="border-b">
          <CardTitle>Версии проектного промпта</CardTitle>
          <CardDescription>Активна только одна версия с одинаковым системным именем.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {prompts.map((prompt) => (
            <article key={prompt.id} className="rounded-lg border border-slate-200 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="font-medium">Версия {prompt.promptVersion}</h2>
                    {prompt.active ? <Badge>Активна</Badge> : <Badge variant="outline">Неактивна</Badge>}
                  </div>
                  <p className="mt-1 text-xs text-slate-500">
                    {formatDateTime(prompt.createdAt)} · SHA-256 {prompt.checksum.slice(0, 12)}…
                  </p>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={prompt.active || activatingId !== null}
                  onClick={() => activateVersion(prompt.id)}
                >
                  {activatingId === prompt.id ? "Активируем…" : "Активировать"}
                </Button>
              </div>
              <details className="mt-3">
                <summary className="focus-ring cursor-pointer rounded text-sm text-teal-700">
                  Показать содержимое
                </summary>
                <pre className="mt-3 max-h-64 overflow-auto whitespace-pre-wrap rounded-lg bg-slate-50 p-3 text-xs leading-5 text-slate-700">
                  {prompt.content}
                </pre>
              </details>
            </article>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="border-b">
          <CardTitle>Новая версия</CardTitle>
          <CardDescription>Исходная версия сохраняется; изменение создаёт новую запись.</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="space-y-4" onSubmit={createVersion}>
            <label className="block space-y-1.5 text-sm font-medium">
              <span>Номер версии</span>
              <Input
                value={promptVersion}
                onChange={(event) => setPromptVersion(event.target.value)}
                placeholder="Например: 1.1.0"
                maxLength={32}
                required
              />
            </label>
            <label className="block space-y-1.5 text-sm font-medium">
              <span>Содержимое</span>
              <Textarea
                value={content}
                onChange={(event) => setContent(event.target.value)}
                minLength={40}
                maxLength={20_000}
                className="min-h-80 font-mono text-xs leading-5"
                required
              />
            </label>
            <label className="flex items-start gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={activate}
                onChange={(event) => setActivate(event.target.checked)}
                className="mt-0.5 size-4 accent-teal-700"
              />
              <span>Сразу активировать новую версию</span>
            </label>
            <div className="flex flex-wrap items-center gap-3">
              <Button type="submit" disabled={pending}>
                {pending ? "Создаём…" : "Создать версию"}
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
    </div>
  );
}

function sortPrompts(prompts: AdminPromptView[]): AdminPromptView[] {
  return prompts.toSorted((left, right) => {
    if (left.active !== right.active) return left.active ? -1 : 1;
    return right.createdAt.localeCompare(left.createdAt);
  });
}

async function readJson<T extends { error?: { message?: string } }>(response: Response): Promise<T> {
  const payload = (await response.json()) as T;
  if (!response.ok) throw new Error(payload.error?.message ?? "Не удалось изменить промпт.");
  return payload;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Не удалось изменить промпт.";
}
