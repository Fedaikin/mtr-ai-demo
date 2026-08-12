"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

export interface AdminDictionaryView {
  id: string;
  dictionaryType: string;
  key: string;
  values: string[];
  active: boolean;
  version: number;
}

export function AdminConfigDictionaries({
  initialDictionaries,
}: {
  initialDictionaries: AdminDictionaryView[];
}) {
  const router = useRouter();
  const [dictionaries, setDictionaries] = useState(initialDictionaries);
  const [query, setQuery] = useState("");
  const normalizedQuery = query.trim().toLocaleLowerCase("ru-RU");
  const visible = normalizedQuery
    ? dictionaries.filter(
        (dictionary) =>
          dictionary.key.toLocaleLowerCase("ru-RU").includes(normalizedQuery) ||
          dictionary.values.some((value) => value.toLocaleLowerCase("ru-RU").includes(normalizedQuery)),
      )
    : dictionaries;

  function replaceDictionary(next: AdminDictionaryView) {
    setDictionaries((current) => current.map((item) => (item.id === next.id ? next : item)));
    router.refresh();
  }

  return (
    <div className="space-y-4">
      <div className="max-w-md">
        <label className="block space-y-1.5 text-sm font-medium">
          <span>Поиск по термину или каноническому типу</span>
          <Input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Например: труба или PIPE"
          />
        </label>
      </div>
      <p className="text-xs text-slate-500">Показано {visible.length} из {dictionaries.length} записей.</p>
      <div className="grid gap-4 xl:grid-cols-2">
        {visible.map((dictionary) => (
          <DictionaryEditor
            key={dictionary.id}
            dictionary={dictionary}
            onSaved={replaceDictionary}
          />
        ))}
      </div>
      {visible.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500">
          Совпадений не найдено.
        </div>
      ) : null}
    </div>
  );
}

function DictionaryEditor({
  dictionary,
  onSaved,
}: {
  dictionary: AdminDictionaryView;
  onSaved: (dictionary: AdminDictionaryView) => void;
}) {
  const [valuesText, setValuesText] = useState(dictionary.values.join("\n"));
  const [pending, setPending] = useState(false);
  const [feedback, setFeedback] = useState<{ tone: "success" | "error"; text: string } | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setFeedback(null);
    try {
      const values = [...new Set(valuesText.split(/[\n,]/).map((value) => value.trim()).filter(Boolean))];
      const response = await fetch(`/api/admin/dictionaries/${encodeURIComponent(dictionary.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ values, version: dictionary.version }),
      });
      const payload = await readJson<{
        dictionary: AdminDictionaryView;
        error?: { message?: string };
      }>(response);
      onSaved(payload.dictionary);
      setValuesText(payload.dictionary.values.join("\n"));
      setFeedback({ tone: "success", text: "Словарь сохранён и записан в аудит." });
    } catch (error) {
      setFeedback({ tone: "error", text: errorMessage(error) });
    } finally {
      setPending(false);
    }
  }

  return (
    <Card>
      <CardHeader className="border-b">
        <div className="flex items-center gap-2">
          <CardTitle className="font-mono">{dictionary.key}</CardTitle>
          <Badge variant={dictionary.active ? "secondary" : "outline"}>
            {dictionary.active ? "Активен" : "Отключён"}
          </Badge>
        </div>
        <CardDescription>
          {dictionary.dictionaryType} · версия записи {dictionary.version}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form className="space-y-3" onSubmit={submit}>
          <label className="block space-y-1.5 text-sm font-medium">
            <span>Синонимы — по одному на строку</span>
            <Textarea
              value={valuesText}
              onChange={(event) => setValuesText(event.target.value)}
              className="min-h-36"
              maxLength={5_000}
              required
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
  if (!response.ok) throw new Error(payload.error?.message ?? "Не удалось сохранить словарь.");
  return payload;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Не удалось сохранить словарь.";
}
