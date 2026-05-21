@AGENTS.md

## Git

- **Все коммиты и описания PR — на русском языке.** Заказчик не читает по-английски,
  поэтому сообщения коммитов должны понятно описывать, что сделано (без англоязычных
  conventional-commit префиксов вроде `feat:`/`fix:`).

## UI-компоненты — shadcn/ui

### Правила работы с компонентами

- **Добавлять новые компоненты через CLI:**
  ```bash
  npx shadcn add <component> -c apps/web
  ```
- **Документация по компоненту:**
  ```bash
  npx shadcn docs <component> -c apps/web
  ```
- **НЕ создавать кастомные обёртки** поверх shadcn/ui компонентов.
- **Компоненты добавляются** в `apps/web/src/components/ui/` напрямую.
- **Импортировать** из `@/components/ui/<component>`.

### Что НЕ использовать

- `@platform/ui/atoms` — заменены shadcn/ui
- `@platform/ui/molecules` — заменены shadcn/ui
- Storybook — удалён; используй `npx shadcn docs` для документации

### Что продолжать использовать

- `@platform/ui/templates` (AuthLayout, DashboardLayout) — только layout-обёртки
- Design tokens (CSS-переменные `--color-*`, `--spacing-*`)
