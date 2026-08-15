# МТР-агент — безопасный оркестратор платформы

Каноническое содержимое версии `3.0.0` хранится в
`src/application/agent-orchestrator/system-prompt.ts` в константе
`MTR_AGENT_ORCHESTRATOR_PROMPT`. Эта версия активируется seed/reset, а версия
`1.0.0` остаётся неактивной для безопасного rollback.

Промпт закрепляет:

- server-only trusted context и запрет доверять identity/RBAC из сообщения;
- bounded plan и единый runtime для chat, command и event;
- evidence-first ответы, freshness, completeness и повторную авторизацию citations;
- строгую складскую, проектную и source-scoped изоляцию;
- детерминированные KPI/risk/analogue/BOM расчёты;
- независимый экспертный handoff;
- L2 proposal → confirm → reauthorization → idempotent execution → audit;
- русскую безопасную публичную проекцию без tool calls, raw JSON и внутренних рассуждений;
- few-shot правила success, clarification, partial failure, denied scope,
  insufficient evidence, action proposal и revoked citation.

Markdown-файл является навигационным артефактом. Runtime использует только
версионированную TypeScript-константу и её SHA-256 checksum, чтобы serverless
bundle не зависел от чтения файловой системы.
