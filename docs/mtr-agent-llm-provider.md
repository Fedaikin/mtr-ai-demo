# OpenAI provider универсального МТР-агента

## Роль provider

Primary-интеграция использует официальный OpenAI Node SDK и Responses API. Provider планирует только вызовы allowlisted read capabilities и может улучшить формулировку пояснений. Он не вычисляет остатки, score, дозаказ, сроки, verdict, permissions и не записывает напрямую в БД.

System prompt version: `4.1.0`. Dataset: `universal-chat-v1@1.0.0`. План и финальная проза проверяются строгими Zod-схемами.

## Конфигурация

```dotenv
MTR_AGENT_ORCHESTRATOR_ENABLED=true
MTR_AGENT_UNIVERSAL_CHAT_ENABLED=true
MTR_AGENT_LIVE_LLM_ENABLED=true
OPENAI_MODEL=<закреплённый exact model id>
OPENAI_API_KEY=<server-side secret>
MTR_AGENT_LLM_TIMEOUT_MS=15000
MTR_AGENT_LLM_MAX_OUTPUT_TOKENS=4000
MTR_AGENT_LLM_MAX_RETRIES=1
```

`OPENAI_API_KEY` и model ID не отправляются клиенту. Key задаётся только через secret manager Preview. Присутствие integration state `LLM=AVAILABLE` само по себе не доказывает, что live provider настроен.

## Ограничения выполнения

- максимум 12 capability calls;
- максимум 4 planning rounds;
- максимум 3 параллельных read-вызова;
- server-side timeout, output-token budget и bounded retry;
- `store: false` для Responses request;
- capability arguments проходят строгую schema и RBAC до retrieval;
- identity, роли и permissions не входят в provider arguments;
- trace хранит provider/model/prompt version, duration и usage, но не reasoning и не secret.

## Deterministic fallback

Fallback включается при отсутствующей конфигурации, timeout, provider outage, rate limit, неверной structured schema или запрещённом capability. Он использует тот же scoped read port и доменные формулы, поэтому поддерживаемые запросы сохраняют факты и citations. Неизвестный объект, неполный источник или неоднозначное имя дают clarification/missing-data и `requiresHumanReview`, а не выдуманный ответ.

## Что считается доказательством G3

Локальные unit/integration-тесты доказывают SDK boundary, schema validation, budget, timeout и fallback. Они не доказывают live LLM. Для G3 нужны фактические Preview-вызовы на exact deployment SHA, закреплённый model ID, trace provider/model/prompt, safety cases и grounded task score не ниже порога. Пока Preview secret или deploy access отсутствует, статус этого подпункта — внешний blocker.

## Аварийное отключение

1. Установить `MTR_AGENT_LIVE_LLM_ENABLED=false` и выполнить новый Preview deployment/restart.
2. Для полного stop нового orchestrator execution установить `MTR_AGENT_KILL_SWITCH=true`.
3. Deterministic universal chat можно оставить включённым: он не требует OpenAI key.
4. Не удалять key из логов: ключ никогда не должен был туда попасть; при подозрении на утечку его нужно отозвать в secret manager.
