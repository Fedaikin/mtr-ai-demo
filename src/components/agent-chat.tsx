"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, KeyboardEvent, useEffect, useRef, useState, useTransition } from "react";
import { AgentCommandResult } from "@/components/agent-command-result";
import type { PublicAgentCommandResult } from "@/application/agent-orchestrator/public-projection";
import type { AgentCommandKey } from "@/domain/agent/commands";
import type { AgentContextSelection } from "@/domain/agent/context";

export interface AgentThreadView {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export interface AgentCitationView {
  sourceSystem: string;
  entityId: string;
  versionOrSnapshot: string;
  clauseId: string | null;
}

export interface AgentMessageView {
  id: string;
  threadId: string;
  role: string;
  content: string;
  structuredOutput: Record<string, unknown> | null;
  createdAt: string;
  citations: AgentCitationView[];
  pending?: boolean;
}

interface AgentChatProps {
  displayName: string;
  initialThreads: AgentThreadView[];
  initialThreadId: string | null;
  initialMessages: AgentMessageView[];
  context?: AgentContextSelection;
}

interface StructuredAgentOutput {
  confidence?: number;
  requiresHumanReview?: boolean;
}

const SUGGESTIONS = [
  "Подбери взаимозаменяемые позиции для CAT-DEMO-PIP-0005.",
  "Покажи состав узла CAT-DEMO-ASM-PIP-0001.",
  "Кто отвечает за позицию position-007?",
  "Подбери составной аналог для позиции position-022.",
  "Почему ожидается дефицит по position-portfolio-072-003 и какой вариант лучше?",
] as const;

const QUICK_COMMANDS: readonly { key: AgentCommandKey; label: string }[] = [
  { key: "SUMMARY", label: "Оперативная сводка" },
  { key: "MY_TASKS", label: "Мои задачи" },
  { key: "RISKS", label: "Риски" },
  { key: "STOCKS", label: "Остатки" },
  { key: "KPI", label: "KPI и SLA" },
];

const DATE_TIME_FORMAT = new Intl.DateTimeFormat("ru-RU", {
  day: "2-digit",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Europe/Moscow",
});

export function AgentChat({
  displayName,
  initialThreads,
  initialThreadId,
  initialMessages,
  context = {},
}: AgentChatProps) {
  const router = useRouter();
  const [threads, setThreads] = useState(initialThreads);
  const [activeThreadId, setActiveThreadId] = useState(initialThreadId);
  const [messages, setMessages] = useState(initialMessages);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [commandResult, setCommandResult] = useState<PublicAgentCommandResult | null>(null);
  const [isPending, startTransition] = useTransition();
  const activeThreadRef = useRef(activeThreadId);
  const requestSequenceRef = useRef(0);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const messageEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    activeThreadRef.current = activeThreadId;
  }, [activeThreadId]);

  useEffect(() => {
    messageEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, loadingMessages]);

  const activeThread = threads.find((thread) => thread.id === activeThreadId) ?? null;

  function handleSelectThread(threadId: string) {
    if (threadId === activeThreadRef.current || isPending) return;
    startTransition(async () => {
      setError(null);
      setActiveThreadId(threadId);
      activeThreadRef.current = threadId;
      setMessages([]);
      setLoadingMessages(true);
      const sequence = ++requestSequenceRef.current;
      try {
        const response = await fetch(`/api/agent/threads/${encodeURIComponent(threadId)}/messages`, {
          cache: "no-store",
        });
        const payload = await readApiResponse<{ items: AgentMessageView[] }>(response);
        if (sequence === requestSequenceRef.current && activeThreadRef.current === threadId) {
          setMessages(payload.items);
        }
      } catch (caught) {
        if (sequence === requestSequenceRef.current) setError(errorMessage(caught));
      } finally {
        if (sequence === requestSequenceRef.current) setLoadingMessages(false);
      }
    });
  }

  function handleNewThread() {
    if (isPending) return;
    startTransition(async () => {
      setError(null);
      try {
        const thread = await createThread("Новый диалог");
        setThreads((current) => [thread, ...current.filter((item) => item.id !== thread.id)]);
        setActiveThreadId(thread.id);
        activeThreadRef.current = thread.id;
        requestSequenceRef.current += 1;
        setMessages([]);
        composerRef.current?.focus();
      } catch (caught) {
        setError(errorMessage(caught));
      }
    });
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void sendMessage(draft);
  }

  function handleComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      if (!isPending && draft.trim()) void sendMessage(draft);
    }
  }

  async function sendMessage(value: string) {
    const question = value.trim();
    if (!question || isPending) return;

    setDraft("");
    setError(null);
    startTransition(async () => {
      let threadId = activeThreadRef.current;
      try {
        if (!threadId) {
          const thread = await createThread(toThreadTitle(question));
          threadId = thread.id;
          setThreads((current) => [thread, ...current.filter((item) => item.id !== thread.id)]);
          setActiveThreadId(thread.id);
          activeThreadRef.current = thread.id;
        }

        const optimisticId = `pending-${crypto.randomUUID()}`;
        const optimisticMessage: AgentMessageView = {
          id: optimisticId,
          threadId,
          role: "user",
          content: question,
          structuredOutput: null,
          createdAt: new Date().toISOString(),
          citations: [],
          pending: true,
        };
        setMessages((current) => [...current, optimisticMessage]);

        const response = await fetch(
          `/api/agent/threads/${encodeURIComponent(threadId)}/messages`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ message: question, threadId, selection: context }),
          },
        );
        const payload = await readApiResponse<{ items: AgentMessageView[] }>(response);
        if (activeThreadRef.current === threadId) {
          setMessages((current) => {
            const returnedIds = new Set(payload.items.map((message) => message.id));
            return [
              ...current.filter(
                (message) => message.id !== optimisticId && !returnedIds.has(message.id),
              ),
              ...payload.items,
            ];
          });
        }
        const updatedAt = payload.items.at(-1)?.createdAt ?? new Date().toISOString();
        setThreads((current) => {
          const updated = current.map((thread) =>
            thread.id === threadId
              ? { ...thread, updatedAt, version: thread.version + 2 }
              : thread,
          );
          return updated.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
        });
        router.refresh();
      } catch (caught) {
        setError(errorMessage(caught));
        setDraft((current) => current || question);
        if (threadId && activeThreadRef.current === threadId) {
          await reloadMessages(threadId);
        }
      }
    });
  }

  function runQuickCommand(commandKey: AgentCommandKey) {
    if (isPending) return;
    startTransition(async () => {
      setError(null);
      setCommandResult(null);
      try {
        const response = await fetch(`/api/agent/commands/${commandKey}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ context }),
        });
        const payload = await readApiResponse<{ result: PublicAgentCommandResult }>(response);
        setCommandResult(payload.result);
      } catch (caught) {
        setError(errorMessage(caught));
      }
    });
  }

  async function reloadMessages(threadId: string) {
    try {
      const response = await fetch(`/api/agent/threads/${encodeURIComponent(threadId)}/messages`, {
        cache: "no-store",
      });
      const payload = await readApiResponse<{ items: AgentMessageView[] }>(response);
      if (activeThreadRef.current === threadId) setMessages(payload.items);
    } catch {
      setMessages((current) => current.filter((message) => !message.pending));
    }
  }

  async function createThread(title: string): Promise<AgentThreadView> {
    const response = await fetch("/api/agent/threads", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title }),
    });
    const payload = await readApiResponse<{ thread: AgentThreadView }>(response);
    return payload.thread;
  }

  return (
    <section
      aria-label="Диалог с МТР-аналитиком"
      className="flex h-full min-h-0 min-w-0 max-w-full flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm lg:grid lg:grid-cols-[260px_minmax(0,1fr)]"
    >
      <aside className="shrink-0 border-b border-slate-200 bg-slate-50/70 lg:flex lg:min-h-0 lg:flex-col lg:border-b-0 lg:border-r">
        <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
          <div>
            <h2 className="text-sm font-semibold text-slate-950">Диалоги</h2>
            <p className="mt-0.5 text-xs text-slate-500">Сохранены в базе</p>
          </div>
          <button
            type="button"
            onClick={handleNewThread}
            disabled={isPending}
            className="focus-ring rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:border-teal-300 hover:text-teal-800 disabled:cursor-not-allowed disabled:opacity-50"
          >
            + Новый
          </button>
        </div>
        <nav aria-label="Сохранённые диалоги" className="max-h-28 overflow-y-auto p-2 lg:min-h-0 lg:max-h-none lg:flex-1">
          {threads.map((thread) => {
            const active = thread.id === activeThreadId;
            return (
              <button
                key={thread.id}
                type="button"
                onClick={() => handleSelectThread(thread.id)}
                aria-current={active ? "page" : undefined}
                className={`focus-ring mb-1 block w-full rounded-lg px-3 py-2.5 text-left transition-colors ${
                  active
                    ? "bg-teal-50 text-teal-950 ring-1 ring-inset ring-teal-200"
                    : "text-slate-700 hover:bg-white hover:text-slate-950"
                }`}
              >
                <span className="block truncate text-sm font-medium">{thread.title}</span>
                <span className="mt-1 block text-[11px] text-slate-500">
                  {formatDateTime(thread.updatedAt)}
                </span>
              </button>
            );
          })}
          {threads.length === 0 ? (
            <p className="px-3 py-5 text-center text-xs leading-5 text-slate-500">
              Диалогов пока нет. Выберите пример вопроса — он будет создан автоматически.
            </p>
          ) : null}
        </nav>
      </aside>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="flex shrink-0 items-center justify-between gap-4 border-b border-slate-100 px-4 py-3 sm:px-5">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-slate-950">
              {activeThread?.title ?? "Новый вопрос"}
            </p>
            <p className="mt-0.5 text-xs text-slate-500">
              {displayName} · факты только через инструменты
            </p>
          </div>
          <span className="shrink-0 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] font-medium text-emerald-800">
            Детерминированный mock
          </span>
        </div>

        <div className="shrink-0 border-b border-slate-100 bg-white px-4 py-2 sm:px-5" aria-label="Быстрые команды МТР-агента">
          <div className="flex max-w-full gap-2 overflow-x-auto pb-1">
            {QUICK_COMMANDS.map((command) => (
              <button key={command.key} type="button" disabled={isPending} onClick={() => runQuickCommand(command.key)} className="focus-ring shrink-0 rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-700 hover:border-teal-300 hover:bg-teal-50 hover:text-teal-900 disabled:opacity-50">
                {command.label}
              </button>
            ))}
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto bg-[#fbfcfc] px-4 py-5 sm:px-6" aria-live="polite">
          {commandResult ? <div className="mb-5"><AgentCommandResult result={commandResult} /></div> : null}
          {loadingMessages ? <LoadingMessage /> : null}
          {!loadingMessages && messages.length === 0 ? (
            <EmptyConversation onSelect={(suggestion) => void sendMessage(suggestion)} pending={isPending} />
          ) : null}
          <div className="space-y-5">
            {messages.map((message) => (
              <AgentMessage key={message.id} message={message} />
            ))}
            {isPending && messages.at(-1)?.role === "user" ? <ThinkingMessage /> : null}
          </div>
          <div ref={messageEndRef} />
        </div>

        <div className="shrink-0 border-t border-slate-200 bg-white p-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:p-5">
          {error ? (
            <div role="alert" className="mb-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-900">
              {error}
            </div>
          ) : null}
          <form onSubmit={handleSubmit}>
            <label htmlFor="agent-message" className="sr-only">
              Вопрос МТР-аналитику
            </label>
            <div className="rounded-xl border border-slate-300 bg-white p-2 shadow-sm focus-within:border-teal-500 focus-within:ring-2 focus-within:ring-teal-100">
              <textarea
                ref={composerRef}
                id="agent-message"
                data-testid="agent-input"
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={handleComposerKeyDown}
                maxLength={4_000}
                rows={3}
                disabled={isPending}
                placeholder="Например: подбери замену для CAT-DEMO-PIP-0005"
                className="block w-full resize-none border-0 bg-transparent px-2 py-1 text-sm leading-6 text-slate-950 outline-none placeholder:text-slate-400 disabled:cursor-wait"
              />
              <div className="flex items-center justify-between gap-3 px-2 pt-2">
                <p className="text-[11px] text-slate-500">Enter — отправить · Shift+Enter — новая строка</p>
                <button
                  type="submit"
                  data-testid="agent-send"
                  disabled={isPending || !draft.trim()}
                  className="focus-ring rounded-md bg-teal-700 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-800 disabled:cursor-not-allowed disabled:bg-slate-300"
                >
                  {isPending ? "Формирую ответ…" : "Отправить"}
                </button>
              </div>
            </div>
          </form>
          {messages.length > 0 ? (
            <div className="mt-3 flex gap-2 overflow-x-auto pb-1" aria-label="Примеры вопросов">
              {SUGGESTIONS.map((suggestion) => (
                <button
                  key={suggestion}
                  type="button"
                  disabled={isPending}
                  onClick={() => setDraft(suggestion)}
                  className="focus-ring shrink-0 rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs text-slate-600 hover:border-teal-200 hover:bg-teal-50 hover:text-teal-900 disabled:opacity-50"
                >
                  {shortSuggestion(suggestion)}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}

function EmptyConversation({
  onSelect,
  pending,
}: {
  onSelect: (suggestion: string) => void;
  pending: boolean;
}) {
  return (
    <div className="mx-auto max-w-2xl py-8 text-center sm:py-12">
      <div className="mx-auto flex size-11 items-center justify-center rounded-xl bg-teal-700 text-sm font-bold text-white">
        AI
      </div>
      <h3 className="mt-4 text-lg font-semibold text-slate-950">Вопрос по данным МТР</h3>
      <p className="mx-auto mt-2 max-w-lg text-sm leading-6 text-slate-600">
        Аналитик сначала обращается к мокам Appius, SAP, нормативным правилам или результатам сценария, а затем формирует ответ со ссылками на источники.
      </p>
      <div className="mt-6 grid gap-2 text-left sm:grid-cols-2">
        {SUGGESTIONS.map((suggestion) => (
          <button
            key={suggestion}
            type="button"
            disabled={pending}
            onClick={() => onSelect(suggestion)}
            className="focus-ring rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm leading-5 text-slate-700 shadow-sm hover:border-teal-300 hover:text-teal-900 disabled:opacity-50"
          >
            {suggestion}
          </button>
        ))}
      </div>
    </div>
  );
}

function AgentMessage({ message }: { message: AgentMessageView }) {
  const assistant = message.role === "assistant";
  const output = parseStructuredOutput(message.structuredOutput);
  return (
    <article
      data-testid="agent-message"
      className={`flex ${assistant ? "justify-start" : "justify-end"}`}
      aria-label={assistant ? "Ответ МТР-аналитика" : "Сообщение пользователя"}
    >
      <div
        className={`max-w-[92%] rounded-xl px-4 py-3 sm:max-w-[82%] ${
          assistant
            ? "border border-slate-200 bg-white text-slate-800 shadow-sm"
            : "bg-teal-700 text-white"
        } ${message.pending ? "opacity-65" : ""}`}
      >
        <div className="mb-2 flex flex-wrap items-center gap-2 text-[11px]">
          <span className={`font-semibold ${assistant ? "text-teal-800" : "text-teal-50"}`}>
            {assistant ? "МТР-аналитик" : "Вы"}
          </span>
          <time className={assistant ? "text-slate-400" : "text-teal-100"} dateTime={message.createdAt}>
            {formatDateTime(message.createdAt)}
          </time>
          {message.pending ? <span className="text-teal-100">сохраняю…</span> : null}
        </div>
        <p className="whitespace-pre-wrap text-sm leading-6">{message.content}</p>

        {assistant && output ? (
          <div className="mt-4 border-t border-slate-100 pt-4">
            <AgentDecisionMeta output={output} />
          </div>
        ) : null}

        {assistant && message.citations.length > 0 ? (
          <Citations citations={message.citations} />
        ) : null}

      </div>
    </article>
  );
}

function AgentDecisionMeta({ output }: { output: StructuredAgentOutput }) {
  if (output.confidence === undefined && output.requiresHumanReview === undefined) return null;
  return (
    <div className="flex flex-wrap gap-2 text-[11px]">
      {output.confidence !== undefined ? (
        <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 font-medium text-slate-700">
          Уверенность {Math.round(output.confidence * 100)}%
        </span>
      ) : null}
      {output.requiresHumanReview ? (
        <span className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 font-medium text-amber-900">
          Нужна проверка специалиста
        </span>
      ) : (
        <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 font-medium text-emerald-800">
          Дополнительная проверка не требуется
        </span>
      )}
    </div>
  );
}

function Citations({ citations }: { citations: AgentCitationView[] }) {
  return (
    <section className="mt-4 border-t border-slate-100 pt-4" data-testid="agent-citations">
      <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
        Источники · {citations.length}
      </h4>
      <div className="mt-2 flex flex-wrap gap-2">
        {citations.map((citation, index) => {
          const href = citationHref(citation);
          const content = (
            <>
              <span className="font-semibold text-teal-800">{sourceLabel(citation.sourceSystem)}</span>
              <span className="font-mono text-[10px] text-slate-600">{citation.entityId}</span>
              <span className="text-[10px] text-slate-400">{citation.versionOrSnapshot}</span>
              {citation.clauseId ? (
                <span className="text-[10px] text-slate-500">п. {citation.clauseId}</span>
              ) : null}
            </>
          );
          const className =
            "focus-ring inline-flex max-w-full flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-2 text-xs hover:border-teal-200 hover:bg-teal-50";
          return href ? (
            <Link
              key={`${citation.sourceSystem}-${citation.entityId}-${citation.clauseId ?? index}`}
              href={href}
              data-testid="agent-citation"
              className={className}
            >
              {content}
            </Link>
          ) : (
            <span
              key={`${citation.sourceSystem}-${citation.entityId}-${citation.clauseId ?? index}`}
              data-testid="agent-citation"
              className={className}
            >
              {content}
            </span>
          );
        })}
      </div>
      {citations.some((citation) => citation.sourceSystem === "NORMATIVE") ? (
        <p className="mt-2 text-[11px] text-slate-500">Нормативные источники — синтетические демонстрационные правила.</p>
      ) : null}
    </section>
  );
}

function LoadingMessage() {
  return (
    <div className="py-12 text-center text-sm text-slate-500" role="status">
      Загружаю сохранённые сообщения…
    </div>
  );
}

function ThinkingMessage() {
  return (
    <div className="flex justify-start" role="status">
      <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600 shadow-sm">
        Проверяю спецификацию…
      </div>
    </div>
  );
}

function parseStructuredOutput(value: Record<string, unknown> | null): StructuredAgentOutput | null {
  if (!value) return null;
  return {
    confidence:
      typeof value.confidence === "number" && value.confidence >= 0 && value.confidence <= 1
        ? value.confidence
        : undefined,
    requiresHumanReview:
      typeof value.requiresHumanReview === "boolean" ? value.requiresHumanReview : undefined,
  };
}

function citationHref(citation: AgentCitationView): string | null {
  const id = encodeURIComponent(citation.entityId);
  if (citation.sourceSystem === "SAP" && /^SAP-DEMO-/iu.test(citation.entityId)) {
    return `/materials/${id}`;
  }
  if (citation.sourceSystem === "CATALOG" && /^CAT-DEMO-/iu.test(citation.entityId)) {
    return `/catalog/${id}`;
  }
  if (citation.sourceSystem === "SCENARIO") return `/runs/${id}`;
  if (citation.sourceSystem === "REPORT") return `/reports/${id}`;
  if (citation.sourceSystem === "APPIUS" && /^spec-/iu.test(citation.entityId)) {
    return `/specifications/${id}`;
  }
  return null;
}

function sourceLabel(sourceSystem: string): string {
  const labels: Record<string, string> = {
    APPIUS: "Appius PLM",
    SAP: "SAP S/4HANA",
    CATALOG: "Промышленный каталог",
    NORMATIVE: "Демонстрационное правило",
    SCENARIO: "Запуск сценария",
    REPORT: "Отчёт",
    RAG: "Нормативная база",
    LLM: "Языковая модель",
    PROCESS_ENGINE: "Процесс анализа",
    TELEMETRY: "Технические измерения",
    METRIC_REGISTRY: "Реестр метрик",
    TASK_STORE: "Сервис задач",
    RISK_ENGINE: "Сервис рисков",
  };
  return labels[sourceSystem] ?? sourceSystem;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function readApiResponse<T>(response: Response): Promise<T> {
  const payload = (await response.json().catch(() => null)) as unknown;
  if (!response.ok) {
    const message =
      isRecord(payload) && isRecord(payload.error) && typeof payload.error.message === "string"
        ? payload.error.message
        : "Не удалось выполнить запрос. Повторите попытку.";
    throw new Error(message);
  }
  return payload as T;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Не удалось выполнить запрос. Повторите попытку.";
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? "—" : DATE_TIME_FORMAT.format(date);
}

function toThreadTitle(question: string): string {
  const compact = question.replace(/\s+/gu, " ").trim();
  return compact.length <= 80 ? compact : `${compact.slice(0, 77)}…`;
}

function shortSuggestion(suggestion: string): string {
  if (suggestion.includes("взаимозаменяемые")) return "Замены из каталога";
  if (suggestion.includes("состав узла")) return "Состав узла";
  if (suggestion.includes("остаток")) return "Остаток материала";
  if (suggestion.includes("отвечает")) return "Ответственность";
  if (suggestion.includes("аналог")) return "Составной аналог";
  return "Версия спецификации";
}
