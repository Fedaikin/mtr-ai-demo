"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChangeEvent, DragEvent, FormEvent, KeyboardEvent, useEffect, useRef, useState, useTransition } from "react";
import { AgentCommandResult } from "@/components/agent-command-result";
import { UniversalAgentResult } from "@/components/universal-agent-result";
import { restorePublicUniversalResult } from "@/application/agent-orchestrator/universal-chat/public-projection";
import {
  restorePublicAgentCommandResult,
  type PublicAgentCommandResult,
} from "@/application/agent-orchestrator/public-projection";
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

interface StagedAttachment {
  localId: string;
  fileName: string;
  status: "UPLOADING" | "READY" | "ERROR";
  uploadId?: string;
  parseStatus?: string;
  error?: string;
}

interface AttachmentImportView {
  status: "PREVIEW" | "REVIEW_REQUIRED" | "PUBLISHED";
  fileName: string;
  totalRows: number;
  validRows: number;
  invalidRows: number;
  warnings: string[];
  errors: string[];
  previewRows: Array<{ code: string; name: string; quantity: number; unit: string }>;
  targetLabel: string | null;
  published?: { href: string; versionNumber: number; positionCount: number };
}

interface ChatActionImpact {
  targetDisplayName: string;
  targetLogin: string | null;
  currentStatus: string;
  currentRoles: string[];
  projectLabel: string | null;
  newState: string;
  affectedSessions: number;
  affectedAssignments: number;
  segregationOfDuties: "PASS" | "BLOCKED";
  lastAdministratorRisk: boolean;
  lastProjectManagerRisk: boolean;
}

interface ChatActionProposal {
  id: string;
  actionType: string;
  summary: string;
  consequences: string[];
  status: "PROPOSED" | "EXECUTING" | "SUCCEEDED" | "FAILED" | "EXPIRED" | "CANCELLED";
  expiresAt: string;
  impact: ChatActionImpact;
  result: { safeSummary: string; link: string | null } | null;
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
  const [attachments, setAttachments] = useState<StagedAttachment[]>([]);
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
      if (!isPending && (draft.trim() || readyAttachments(attachments).length > 0)) {
        void sendMessage(draft);
      }
    }
  }

  async function sendMessage(value: string) {
    const question = value.trim();
    const uploaded = readyAttachments(attachments);
    if ((!question && uploaded.length === 0) || isPending || attachments.some((item) => item.status === "UPLOADING")) return;

    setDraft("");
    setError(null);
    startTransition(async () => {
      let threadId = activeThreadRef.current;
      try {
        if (!threadId) {
          const thread = await createThread(question ? toThreadTitle(question) : "Импорт спецификации");
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
          content: question || "Приложен файл для проверки.",
          structuredOutput: uploaded.length > 0
            ? { schemaVersion: "agent-attachment-refs-v1", attachments: uploaded }
            : null,
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
            body: JSON.stringify({
              message: question,
              threadId,
              selection: context,
              ...(uploaded.length > 0 ? { attachments: uploaded } : {}),
            }),
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
        setAttachments([]);
      } catch (caught) {
        setError(errorMessage(caught));
        setDraft((current) => current || question);
        if (threadId && activeThreadRef.current === threadId) {
          await reloadMessages(threadId);
        }
      }
    });
  }

  async function stageAttachment(file: File) {
    const localId = crypto.randomUUID();
    setAttachments((current) => [
      ...current,
      { localId, fileName: file.name, status: "UPLOADING" as const },
    ].slice(0, 4));
    const form = new FormData();
    form.set("file", file);
    form.set("purpose", "AGENT_SPECIFICATION");
    try {
      const response = await fetch("/api/uploads", { method: "POST", body: form });
      const payload = await readApiResponse<{ id: string; parseStatus: string }>(response);
      setAttachments((current) => current.map((item) => item.localId === localId
        ? { ...item, status: "READY", uploadId: payload.id, parseStatus: payload.parseStatus }
        : item));
    } catch (caught) {
      setAttachments((current) => current.map((item) => item.localId === localId
        ? { ...item, status: "ERROR", error: errorMessage(caught) }
        : item));
    }
  }

  function handleAttachmentChange(event: ChangeEvent<HTMLInputElement>) {
    const files = [...(event.currentTarget.files ?? [])];
    event.currentTarget.value = "";
    for (const file of files.slice(0, Math.max(0, 4 - attachments.length))) void stageAttachment(file);
  }

  function handleAttachmentDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    const files = [...event.dataTransfer.files];
    for (const file of files.slice(0, Math.max(0, 4 - attachments.length))) void stageAttachment(file);
  }

  async function removeAttachment(item: StagedAttachment) {
    setAttachments((current) => current.filter((candidate) => candidate.localId !== item.localId));
    if (item.uploadId) {
      await fetch(`/api/uploads/${encodeURIComponent(item.uploadId)}`, { method: "DELETE" }).catch(() => undefined);
    }
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
            Проверяемые источники
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
            <div
              className="rounded-xl border border-slate-300 bg-white p-2 shadow-sm focus-within:border-teal-500 focus-within:ring-2 focus-within:ring-teal-100"
              onDragOver={(event) => event.preventDefault()}
              onDrop={handleAttachmentDrop}
            >
              {attachments.length > 0 ? (
                <div className="mb-2 flex flex-wrap gap-2 px-2" aria-label="Вложения сообщения">
                  {attachments.map((item) => (
                    <span key={item.localId} className={`inline-flex max-w-full items-center gap-2 rounded-lg border px-2.5 py-1.5 text-xs ${item.status === "ERROR" ? "border-rose-200 bg-rose-50 text-rose-800" : "border-teal-200 bg-teal-50 text-teal-900"}`}>
                      <span className="max-w-48 truncate">{item.fileName}</span>
                      <span aria-live="polite">{attachmentStatusLabel(item)}</span>
                      <button type="button" aria-label={`Удалить вложение ${item.fileName}`} onClick={() => void removeAttachment(item)} className="focus-ring rounded px-1 font-semibold">×</button>
                    </span>
                  ))}
                </div>
              ) : null}
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
                <div className="flex min-w-0 items-center gap-3">
                  <label className="focus-within:ring-2 focus-within:ring-teal-500 cursor-pointer rounded-md border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:border-teal-300 hover:text-teal-900">
                    <span>Прикрепить</span>
                    <input data-testid="agent-attachment-input" className="sr-only" type="file" multiple disabled={isPending || attachments.length >= 4} accept=".xlsx,.xls,.csv,.txt,.pdf,.docx,.png,.jpg,.jpeg,.tiff" onChange={handleAttachmentChange} />
                  </label>
                  <p className="hidden text-[11px] text-slate-500 sm:block">Перетащите файл сюда · до 10 МБ</p>
                </div>
                <button
                  type="submit"
                  data-testid="agent-send"
                  disabled={isPending || attachments.some((item) => item.status === "UPLOADING") || (!draft.trim() && readyAttachments(attachments).length === 0)}
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
        Аналитик сначала обращается к Appius, SAP, нормативным правилам или результатам сценария, а затем формирует ответ со ссылками на источники.
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
  const commandResult = assistant
    ? restorePublicAgentCommandResult(message.structuredOutput)
    : null;
  const universalResult = assistant
    ? restorePublicUniversalResult(message.structuredOutput)
    : null;
  const output = parseStructuredOutput(message.structuredOutput);
  const attachmentImport = parseAttachmentImport(message.structuredOutput);
  const actionProposal = parseChatActionProposal(message.structuredOutput);
  const attachmentCount = parseAttachmentRefCount(message.structuredOutput);
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
        {commandResult ? (
          <AgentCommandResult result={commandResult} />
        ) : universalResult ? (
          <UniversalAgentResult result={universalResult} />
        ) : (
          <p className="whitespace-pre-wrap text-sm leading-6">{message.content}</p>
        )}

        {!assistant && attachmentCount > 0 ? (
          <p className="mt-2 text-xs text-teal-50">Вложений: {attachmentCount}</p>
        ) : null}

        {assistant && attachmentImport ? (
          <AttachmentImportCard value={attachmentImport} />
        ) : null}

        {assistant && actionProposal ? (
          <ChatActionCard initial={actionProposal} />
        ) : null}

        {assistant && !commandResult && !universalResult && output ? (
          <div className="mt-4 border-t border-slate-100 pt-4">
            <AgentDecisionMeta output={output} />
          </div>
        ) : null}

        {assistant && !commandResult && message.citations.length > 0 ? (
          <Citations citations={message.citations} />
        ) : null}

        {assistant && !message.pending ? <AgentFeedback messageId={message.id} /> : null}

      </div>
    </article>
  );
}

function ChatActionCard({ initial }: { initial: ChatActionProposal }) {
  const [proposal, setProposal] = useState(initial);
  const [pending, setPending] = useState<"confirm" | "cancel" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function update(operation: "confirm" | "cancel") {
    if (pending || proposal.status !== "PROPOSED") return;
    setPending(operation);
    setError(null);
    try {
      const response = await fetch(`/api/agent/actions/${encodeURIComponent(proposal.id)}/${operation}`, {
        method: "POST",
      });
      const updated = await readApiResponse<Record<string, unknown>>(response);
      const parsed = parsePublicActionProposal(updated);
      if (!parsed) throw new Error("Сервер вернул некорректное состояние действия");
      setProposal(parsed);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setPending(null);
    }
  }

  const impact = proposal.impact;
  return (
    <section className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3" aria-label="Подтверждение действия доступа">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div><p className="text-[11px] font-semibold uppercase tracking-wide text-amber-800">Требуется отдельное подтверждение</p><h4 className="mt-1 text-sm font-semibold text-slate-950">{proposal.summary}</h4></div>
        <span className="rounded-full bg-white px-2 py-1 text-[11px] font-medium text-slate-700">{chatActionStatusLabel(proposal.status)}</span>
      </div>
      <dl className="mt-3 grid gap-2 rounded-md bg-white p-3 text-xs sm:grid-cols-2">
        <div><dt className="text-slate-500">Сотрудник / роль</dt><dd className="font-semibold text-slate-900">{impact.targetDisplayName}{impact.targetLogin ? ` · ${impact.targetLogin}` : ""}</dd></div>
        <div><dt className="text-slate-500">Проект</dt><dd className="font-semibold text-slate-900">{impact.projectLabel ?? "Глобальный контур"}</dd></div>
        <div><dt className="text-slate-500">Сейчас</dt><dd className="text-slate-800">{impact.currentStatus}</dd></div>
        <div><dt className="text-slate-500">После подтверждения</dt><dd className="text-slate-800">{impact.newState}</dd></div>
        <div><dt className="text-slate-500">Активные роли</dt><dd className="text-slate-800">{impact.currentRoles.join(", ") || "Нет"}</dd></div>
        <div><dt className="text-slate-500">Затронуто</dt><dd className="text-slate-800">Сессий: {impact.affectedSessions} · назначений: {impact.affectedAssignments}</dd></div>
      </dl>
      <ul className="mt-3 list-disc space-y-1 pl-5 text-xs text-amber-950">{proposal.consequences.map((item) => <li key={item}>{item}</li>)}</ul>
      {error ? <p role="alert" className="mt-3 text-xs text-rose-800">{error}</p> : null}
      {proposal.status === "PROPOSED" ? (
        <div className="mt-3 flex gap-2">
          <button type="button" disabled={pending !== null} onClick={() => void update("confirm")} className="focus-ring rounded-md bg-teal-700 px-3 py-2 text-xs font-semibold text-white hover:bg-teal-800 disabled:opacity-50">{pending === "confirm" ? "Проверяем…" : "Подтвердить действие"}</button>
          <button type="button" disabled={pending !== null} onClick={() => void update("cancel")} className="focus-ring rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50">{pending === "cancel" ? "Отменяем…" : "Отменить"}</button>
        </div>
      ) : null}
      {proposal.result ? <p className="mt-3 text-xs font-medium text-emerald-800">{proposal.result.safeSummary}</p> : null}
      {proposal.result?.link ? <Link href={proposal.result.link} className="focus-ring mt-2 inline-flex text-xs font-semibold text-teal-800 underline underline-offset-4">Открыть результат</Link> : null}
      <p className="mt-2 text-[11px] text-slate-500">Действительно до {formatDateTime(proposal.expiresAt)}</p>
    </section>
  );
}

function AttachmentImportCard({ value }: { value: AttachmentImportView }) {
  return (
    <section className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-3" aria-label="Результат обработки вложения">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-sm font-semibold text-slate-900">{value.fileName}</h4>
        <span className={`rounded-full px-2 py-1 text-[11px] font-medium ${value.status === "PUBLISHED" ? "bg-emerald-100 text-emerald-800" : value.status === "REVIEW_REQUIRED" ? "bg-amber-100 text-amber-900" : "bg-teal-100 text-teal-900"}`}>
          {value.status === "PUBLISHED" ? "Опубликовано" : value.status === "REVIEW_REQUIRED" ? "Нужна проверка" : "Предпросмотр"}
        </span>
      </div>
      <dl className="mt-3 grid grid-cols-3 gap-2 text-center text-xs">
        <div><dt className="text-slate-500">Всего строк</dt><dd className="mt-1 font-semibold text-slate-900">{value.totalRows}</dd></div>
        <div><dt className="text-slate-500">Валидно</dt><dd className="mt-1 font-semibold text-emerald-800">{value.validRows}</dd></div>
        <div><dt className="text-slate-500">Ошибки</dt><dd className="mt-1 font-semibold text-rose-800">{value.invalidRows}</dd></div>
      </dl>
      {value.targetLabel ? <p className="mt-3 text-xs text-slate-600">Цель: {value.targetLabel}</p> : null}
      {value.previewRows.length > 0 ? (
        <div className="mt-3 max-h-44 overflow-auto rounded-md border border-slate-200 bg-white">
          <table className="w-full min-w-[420px] text-left text-xs">
            <thead className="sticky top-0 bg-slate-100 text-slate-500"><tr><th className="px-2 py-1.5">Код</th><th className="px-2 py-1.5">Наименование</th><th className="px-2 py-1.5">Количество</th></tr></thead>
            <tbody className="divide-y divide-slate-100">{value.previewRows.map((row) => <tr key={row.code}><td className="px-2 py-1.5 font-mono">{row.code}</td><td className="px-2 py-1.5">{row.name}</td><td className="px-2 py-1.5">{row.quantity} {row.unit}</td></tr>)}</tbody>
          </table>
        </div>
      ) : null}
      {[...value.warnings, ...value.errors].slice(0, 5).map((item) => (
        <p key={item} className="mt-2 text-xs text-amber-900">{item}</p>
      ))}
      {value.published ? (
        <Link href={value.published.href} className="focus-ring mt-3 inline-flex rounded-md bg-teal-700 px-3 py-2 text-xs font-semibold text-white hover:bg-teal-800">
          Открыть версию {value.published.versionNumber} · {value.published.positionCount} позиций
        </Link>
      ) : null}
    </section>
  );
}

const FEEDBACK_OPTIONS = [
  { kind: "USEFUL", label: "Полезно" },
  { kind: "INCORRECT_FACT", label: "Неверный факт" },
  { kind: "INCORRECT_CAUSE", label: "Неверная причина" },
  { kind: "MISSING_FACTOR", label: "Пропущен фактор" },
  { kind: "INCORRECT_FORECAST", label: "Неверный прогноз" },
  { kind: "UNSUITABLE_RECOMMENDATION", label: "Не подходит рекомендация" },
  { kind: "MISSING_SOURCE", label: "Не хватает источника" },
  { kind: "MISUNDERSTOOD_QUESTION", label: "Неверно понят вопрос" },
  { kind: "UNSAFE_ACTION", label: "Небезопасное действие" },
] as const;

function AgentFeedback({ messageId }: { messageId: string }) {
  const [state, setState] = useState<"IDLE" | "SENDING" | "SAVED" | "ERROR">("IDLE");

  async function submitFeedback(feedbackKind: (typeof FEEDBACK_OPTIONS)[number]["kind"]) {
    if (state === "SENDING" || state === "SAVED") return;
    setState("SENDING");
    try {
      const response = await fetch(`/api/agent/messages/${encodeURIComponent(messageId)}/feedback`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ feedbackKind }),
      });
      await readApiResponse<unknown>(response);
      setState("SAVED");
    } catch {
      setState("ERROR");
    }
  }

  return (
    <div className="mt-4 border-t border-slate-100 pt-3" data-testid="agent-feedback">
      {state === "SAVED" ? (
        <p role="status" className="text-xs text-teal-800">
          Отзыв сохранён для проверки специалистом. Работа агента автоматически не изменилась.
        </p>
      ) : (
        <details>
          <summary className="focus-ring cursor-pointer text-xs font-medium text-slate-500 hover:text-teal-800">
            Оценить ответ
          </summary>
          <div className="mt-2 flex flex-wrap gap-1.5" aria-label="Тип отзыва">
            {FEEDBACK_OPTIONS.map((option) => (
              <button
                key={option.kind}
                type="button"
                disabled={state === "SENDING"}
                onClick={() => void submitFeedback(option.kind)}
                className="focus-ring rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] text-slate-600 hover:border-teal-300 hover:bg-teal-50 hover:text-teal-900 disabled:opacity-50"
              >
                {option.label}
              </button>
            ))}
          </div>
        </details>
      )}
      {state === "ERROR" ? (
        <p role="alert" className="mt-2 text-xs text-rose-700">
          Не удалось сохранить отзыв. Обновите диалог и повторите попытку.
        </p>
      ) : null}
    </div>
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

function parseAttachmentRefCount(value: Record<string, unknown> | null): number {
  return value && Array.isArray(value.attachments) ? value.attachments.length : 0;
}

function parseAttachmentImport(value: Record<string, unknown> | null): AttachmentImportView | null {
  const raw = value?.attachmentImport;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const item = raw as Record<string, unknown>;
  if (!(["PREVIEW", "REVIEW_REQUIRED", "PUBLISHED"] as const).includes(item.status as never)) return null;
  const previewRows = Array.isArray(item.previewRows)
    ? item.previewRows.flatMap((row) => {
        if (!row || typeof row !== "object" || Array.isArray(row)) return [];
        const record = row as Record<string, unknown>;
        return typeof record.code === "string" && typeof record.name === "string" && typeof record.quantity === "number" && typeof record.unit === "string"
          ? [{ code: record.code, name: record.name, quantity: record.quantity, unit: record.unit }]
          : [];
      })
    : [];
  const publishedRaw = item.published && typeof item.published === "object" && !Array.isArray(item.published)
    ? item.published as Record<string, unknown>
    : null;
  return {
    status: item.status as AttachmentImportView["status"],
    fileName: typeof item.fileName === "string" ? item.fileName : "Вложение",
    totalRows: numberOrZero(item.totalRows),
    validRows: numberOrZero(item.validRows),
    invalidRows: numberOrZero(item.invalidRows),
    warnings: stringArray(item.warnings),
    errors: stringArray(item.errors),
    previewRows,
    targetLabel: typeof item.targetLabel === "string" ? item.targetLabel : null,
    ...(publishedRaw && typeof publishedRaw.href === "string" && publishedRaw.href.startsWith("/specifications/")
      ? {
          published: {
            href: publishedRaw.href,
            versionNumber: numberOrZero(publishedRaw.versionNumber),
            positionCount: numberOrZero(publishedRaw.positionCount),
          },
        }
      : {}),
  };
}

function parseChatActionProposal(value: Record<string, unknown> | null): ChatActionProposal | null {
  if (value?.schemaVersion !== "agent-privileged-action-v1") return null;
  return parsePublicActionProposal(value.actionProposal);
}

function parsePublicActionProposal(value: unknown): ChatActionProposal | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const parameters = raw.parameters && typeof raw.parameters === "object" && !Array.isArray(raw.parameters)
    ? raw.parameters as Record<string, unknown>
    : null;
  const impactRaw = parameters?.impact && typeof parameters.impact === "object" && !Array.isArray(parameters.impact)
    ? parameters.impact as Record<string, unknown>
    : null;
  const statuses = ["PROPOSED", "EXECUTING", "SUCCEEDED", "FAILED", "EXPIRED", "CANCELLED"] as const;
  if (!impactRaw || typeof raw.id !== "string" || typeof raw.summary !== "string" || !statuses.includes(raw.status as never)) return null;
  const resultRaw = raw.result && typeof raw.result === "object" && !Array.isArray(raw.result)
    ? raw.result as Record<string, unknown>
    : null;
  return {
    id: raw.id,
    actionType: typeof raw.actionType === "string" ? raw.actionType : "UNKNOWN",
    summary: raw.summary,
    consequences: stringArray(raw.consequences),
    status: raw.status as ChatActionProposal["status"],
    expiresAt: typeof raw.expiresAt === "string" ? raw.expiresAt : "",
    impact: {
      targetDisplayName: typeof impactRaw.targetDisplayName === "string" ? impactRaw.targetDisplayName : "",
      targetLogin: typeof impactRaw.targetLogin === "string" ? impactRaw.targetLogin : null,
      currentStatus: typeof impactRaw.currentStatus === "string" ? impactRaw.currentStatus : "",
      currentRoles: stringArray(impactRaw.currentRoles),
      projectLabel: typeof impactRaw.projectLabel === "string" ? impactRaw.projectLabel : null,
      newState: typeof impactRaw.newState === "string" ? impactRaw.newState : "",
      affectedSessions: numberOrZero(impactRaw.affectedSessions),
      affectedAssignments: numberOrZero(impactRaw.affectedAssignments),
      segregationOfDuties: impactRaw.segregationOfDuties === "PASS" ? "PASS" : "BLOCKED",
      lastAdministratorRisk: impactRaw.lastAdministratorRisk === true,
      lastProjectManagerRisk: impactRaw.lastProjectManagerRisk === true,
    },
    result: resultRaw
      ? {
          safeSummary: typeof resultRaw.safeSummary === "string" ? resultRaw.safeSummary : "Действие выполнено",
          link: typeof resultRaw.link === "string" && resultRaw.link.startsWith("/") ? resultRaw.link : null,
        }
      : null,
  };
}

function chatActionStatusLabel(value: ChatActionProposal["status"]): string {
  return {
    PROPOSED: "Ожидает подтверждения",
    EXECUTING: "Выполняется",
    SUCCEEDED: "Выполнено",
    FAILED: "Ошибка",
    EXPIRED: "Истекло",
    CANCELLED: "Отменено",
  }[value];
}

function readyAttachments(items: readonly StagedAttachment[]) {
  return items.flatMap((item) => item.status === "READY" && item.uploadId
    ? [{ uploadId: item.uploadId, purpose: "SPECIFICATION" as const }]
    : []);
}

function attachmentStatusLabel(item: StagedAttachment): string {
  if (item.status === "UPLOADING") return "Загрузка…";
  if (item.status === "ERROR") return item.error ?? "Ошибка";
  return item.parseStatus === "PARSED" ? "Готово" : "Нужна проверка";
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string").slice(0, 20) : [];
}

function numberOrZero(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
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
