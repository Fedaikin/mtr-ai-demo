## Результат

Кратко опишите, что теперь работает для пользователя и какой сценарий доказан.

## Scope

- Базовая ветка:
- Head SHA:
- Требование/ТЗ:
- Изменённые модули:
- Миграции:
- Feature flags:

## Обязательный review-файл

- [ ] Создан и заполнен `docs/reviews/<branch-slug>.md`.
- [ ] Ссылка на review-файл:
- [ ] Все неприменимые пункты имеют объяснение `Н/П`.
- [ ] Для заявленных функций приведено runtime evidence.
- [ ] Все P0/P1 и относящиеся к ТЗ P2 устранены.

Используйте канонический шаблон:
`docs/development/review-checklist.md`.

## Проверки

- [ ] `pnpm lint`
- [ ] `pnpm typecheck`
- [ ] `pnpm test`
- [ ] `pnpm privacy:scan`
- [ ] `pnpm eval:agent`
- [ ] `pnpm build`
- [ ] Применимые E2E/security/performance проверки

Результаты и ссылки:

## RBAC, данные и AI

- [ ] API защищён сервером; скрытая кнопка не является единственной защитой.
- [ ] Project/source/catalog/warehouse scope применяется до retrieval.
- [ ] Role switch/revoke не оставляет stale данные или доступ.
- [ ] Миграции проверены на чистой и существующей базе.
- [ ] Статические fixtures не выдаются за оперативные данные.
- [ ] AI-выводы имеют citations/freshness либо явно требуют проверки человеком.
- [ ] Tool calls, secrets, личный текст и chain-of-thought не показаны/не залогированы.

## Preview и rollback

- Preview URL:
- Deployment ID:
- Exact deployed SHA:
- [ ] Preview использует отдельные credentials.
- [ ] Production не изменялся без отдельного разрешения.
- [ ] Rollback описан.

## Ограничения

Перечислите всё, что не реализовано, не проверено или требует внешнего доступа.
