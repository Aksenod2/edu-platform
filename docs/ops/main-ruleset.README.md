# Защита `main` — черновик Ruleset (эпик #174 «замок выпуска»)

> ЧЕРНОВИК. **НЕ применять без явного «ок» заказчика** — меняет процесс работы
> (через main напрямую больше не запушить, всё через PR с зелёным CI).

## Что включает `main-ruleset.json`

- **Require PR** — прямой push в `main` запрещён, только через pull request.
- **Require conversation resolution** — все треды обсуждения в PR должны быть
  закрыты перед мержем (`required_review_thread_resolution`).
- **Required status checks** — мерж блокируется, пока зелёный:
  - `ci` — type-check + lint + сборка web + тесты api (`.github/workflows/ci.yml`,
    это и есть «turbo build»-гейт перед мержем).
  - `strict: true` — ветку нельзя мержить «отстав» от main (требует rebase/обновления).
- **Блок force-push и удаления** ветки (`non_fast_forward`, `deletion`).
- **`required_approving_review_count: 0`** — апрув ревьюера НЕ обязателен (команда
  из одного человека + агенты). Поднять до `1`, когда появится второй ревьюер.

## Почему smoke и checklist НЕ в required status checks

Required status checks в GitHub срабатывают на PR **до мержа**. А `@smoke`
(`vps-deploy.yml`) по дизайну гоняется **после** мержа, против ЖИВОГО прода
(нужен развёрнутый стенд — отдельного staging пока нет). Поэтому:

- `@smoke` остаётся **блокирующим шагом деплоя** с **авто-откатом** на красном —
  это и есть «замок выпуска» в рантайме (см. `vps-deploy.yml`, jobs `smoke` /
  `rollback`).
- Чтобы добавить smoke/«checklist» как **pre-merge** required-чек, нужен либо
  staging-URL (прогон smoke против него на PR), либо отдельный лёгкий job в
  `ci.yml`, выставляющий контекст `checklist`. Когда заведём — добавить сюда
  строки `{ "context": "smoke" }` / `{ "context": "checklist" }`.

## Как применить (только после согласия заказчика)

Через gh CLI (REST API rulesets):

```bash
gh api --method POST \
  -H "Accept: application/vnd.github+json" \
  /repos/Aksenod2/edu-platform/rulesets \
  --input docs/ops/main-ruleset.json
```

Проверить активные рулесеты:

```bash
gh api /repos/Aksenod2/edu-platform/rulesets
```

Откатить (удалить рулесет по id из списка выше):

```bash
gh api --method DELETE /repos/Aksenod2/edu-platform/rulesets/<RULESET_ID>
```

> `bypass_actors` с `actor_id: 5` — встроенная роль admin (RepositoryRole=5):
> владелец репо сможет обойти правило в экстренном случае. Убрать блок
> `bypass_actors`, если обход не нужен совсем.
