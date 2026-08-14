# Подтверждаемые RBAC-действия из чата

## Уровни действий

| Уровень | Поведение |
|---|---|
| L0 | Только чтение и пояснение |
| L1 | Навигация/подготовка безопасного draft без изменения состояния |
| L2 | Allowlisted предметное действие через proposal и отдельное подтверждение |
| L3 | Привилегированное управление пользователем, membership или ролью; отдельное подтверждение, повторная авторизация и атомарная запись обязательны |

LLM не выполняет действие. Он может только распознать запрос и подготовить типизированное предложение. Actor, active project, permissions, authorizationVersion и scope берутся из серверной сессии.

## Разрешённые privileged actions

- активировать или заблокировать пользователя;
- активировать или приостановить membership проекта;
- назначить project/global role;
- отозвать assignment;
- изменить project role;
- активировать или деактивировать role при допустимом impact.

Экспертное решение по МТР, закупка и любые записи в SAP/Appius из чата запрещены.

## Жизненный цикл

```text
Запрос → разрешение цели → permission/impact check → PROPOSED
      → отдельное «Подтвердить действие»
      → повторная проверка session, authorizationVersion, scope и invariants
      → одна атомарная мутация + audit → COMPLETED
```

Proposal привязан к owner, thread, project, payload hash, authorizationVersion, TTL и request key. Duplicate confirm даёт один side effect. Cancel допустим только владельцу до выполнения.

## Защитные инварианты

- self-block и self-escalation запрещены;
- нельзя удалить/заблокировать последнего активного `SYSTEM_ADMIN`;
- нельзя убрать последнего `PROJECT_MANAGER` проекта;
- SoD-конфликты ролей блокируют assignment;
- смена роли, membership, permission или authorizationVersion инвалидирует старое proposal;
- критический revoke отзывает затронутые sessions;
- неоднозначный человек/роль/проект приводит к clarification без утечки существования;
- ошибка audit/transaction не оставляет частичную мутацию.

## Feature flags и rollback

Нужны `MTR_AGENT_ORCHESTRATOR_ENABLED=true`, `MTR_AGENT_UNIVERSAL_CHAT_ENABLED=true` и `MTR_AGENT_ACTIONS_ENABLED=true`. Все по умолчанию выключены. Для немедленной остановки новых действий используйте `MTR_AGENT_ACTIONS_ENABLED=false` или общий `MTR_AGENT_KILL_SWITCH=true`; уже сохранённая история/audit не удаляется.
