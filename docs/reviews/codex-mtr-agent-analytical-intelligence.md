# Review: аналитический интеллект МТР-агента

Ветка: `codex/mtr-agent-analytical-intelligence`

Base: `70543c6c34d6778695a07a5400006742ed5e3a21`
Статус: Gate G0 зафиксирован; G1 remediation разрешён

## Scope

- [x] Scope manifest зафиксирован до production edits.
- [x] Users/RBAC/auth и migrations `0000`–`0006` не изменяются.
- [x] Портфель 83 specifications / 3 584 positions сохраняется.
- [ ] Финальный diff не содержит несвязанных файлов, secrets или generated state.

## Analytics trust boundary

- [ ] Authorization и source filtering выполняются до retrieval.
- [ ] Данные проходят coverage/quality/freshness gate до вывода.
- [ ] LLM не вычисляет business metrics, forecast, scenario score или recommendation score.
- [ ] Evidence graph восстанавливает каждый существенный derived result.
- [ ] Forecast содержит model/version/backtest/interval/assumptions или abstains.
- [ ] Причина отделена от корреляции.
- [ ] Scenario immutable и не меняет operational state.
- [ ] Verifier не создаёт факты и повторно авторизует citations.
- [ ] Recommendation не является human decision.

## Safety и lifecycle

- [ ] Action использует proposal → confirm → reauthorization → idempotency → audit.
- [ ] Feedback не меняет online behavior.
- [ ] LearningCandidate quarantined и требует human approval.
- [ ] Role switch/revoke очищает или повторно авторизует context/history.
- [ ] SAP/Appius write отсутствует.

## Gates

- [x] G0 baseline/coverage: technical PASS, analytical completeness FAIL с точными denominators.
- [ ] G1 semantic/data/evidence foundation.
- [ ] G2 deterministic analytical engines.
- [ ] G3 analytical runtime/verifier/UX.
- [ ] G4 recommendation/autonomy/feedback.
- [ ] ≥200 eval, ≥40 E2E, held-out/adversarial/backtesting/scale.
- [ ] Clean full gate, strict acceptance и scoped fix-loop.
- [ ] Draft PR и Preview exact SHA; Production не затронут.
