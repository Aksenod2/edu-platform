# @platform/ui

Nothing Phone Design System для образовательной платформы.

**Aesthetic:** Monochrome base, red + neon accents, Space Mono dot-matrix typography, strict geometric grid.

## Подключение

В root layout (Next.js `app/layout.tsx`):

```ts
// CSS токены + Tailwind v4
import '@platform/ui/tailwind';
```

Импорт компонентов:

```ts
import { Button, Input, Card, DashboardLayout } from '@platform/ui';
```

## Структура (Atomic Design)

| Уровень   | Компоненты |
|-----------|-----------|
| **atoms** | Avatar, Badge, Button, Divider, Input, Label, Select, Spinner, Textarea, Typography (Heading / Text / Mono) |
| **molecules** | Card + CardHeader + CardBody + CardFooter, EmptyState, FormField, NavItem |
| **organisms** | AssignmentList, Header, Sidebar, StudentCard |
| **templates** | AuthLayout, DashboardLayout + PageHeader |

## Дизайн-токены

Определены в `src/tokens/tailwind.css` через Tailwind v4 `@theme`.  
TypeScript-зеркало для JS-логики: `import { colors, spacing, t } from '@platform/ui/tokens'`.

### CSS Custom Properties

```css
/* Цвета */
var(--color-bg-base)         /* #000000 */
var(--color-bg-surface)      /* #0D0D0D */
var(--color-text-primary)    /* #FFFFFF */
var(--color-text-secondary)  /* #A0A0A0 */
var(--color-accent-red)      /* #FF0000 */
var(--color-accent-neon)     /* #39FF14 */

/* Типография */
var(--font-sans)  /* Space Grotesk */
var(--font-mono)  /* Space Mono */

/* Layout */
var(--sidebar-width)   /* 240px */
var(--header-height)   /* 56px */
var(--content-max-w)   /* 1200px */
```

### Tailwind Utilities

Все токены доступны как Tailwind-классы:
- Цвета: `bg-bg-surface`, `text-text-primary`, `text-accent-red`, `border-border-default`
- Spacing: `gap-4`, `p-6`, `m-8` (8-point grid)
- Border radius: `rounded-xs`, `rounded-sm`, `rounded-md`
- Custom: `glow-red`, `glow-neon`, `border-inset`, `mono`

## Использование компонентов

### Button

```tsx
import { Button } from '@platform/ui';

<Button variant="primary" size="md" loading={false}>
  Отправить
</Button>

// Варианты: primary | secondary | ghost | danger
// Размеры: sm | md | lg
```

### Input / Select / Textarea

```tsx
import { Input, Select, Textarea, Label, FormField } from '@platform/ui';

<FormField label="Email" required>
  <Input size="md" error={false} leftElement={<SearchIcon />} />
</FormField>
```

### Card

```tsx
import { Card, CardHeader, CardBody, CardFooter } from '@platform/ui';

<Card variant="default" padding="md" interactive onClick={handleClick}>
  <CardHeader>Заголовок</CardHeader>
  <CardBody>Контент</CardBody>
</Card>

// Варианты: default | elevated | outlined | interactive
// Padding: none | sm | md | lg
```

### DashboardLayout

```tsx
import { DashboardLayout, PageHeader } from '@platform/ui';

<DashboardLayout
  header={{ user: { name: 'Имя', role: 'admin' }, onLogout: handleLogout }}
  sidebar={{ sections: NAV_SECTIONS }}
  currentPath={pathname}
>
  <PageHeader title="Страница" subtitle="Подзаголовок" action={<Button>...</Button>} />
  {children}
</DashboardLayout>
```

### AuthLayout

```tsx
import { AuthLayout } from '@platform/ui';

<AuthLayout title="Войти" subtitle="Введите данные">
  <form>...</form>
</AuthLayout>
```

## Зависимости

- **Tailwind CSS v4** (`@tailwindcss/vite`)
- **shadcn/ui primitives** (Button, Input, Label, Select, Card, Separator)
- **Radix UI** (@radix-ui/react-label, @radix-ui/react-select, @radix-ui/react-separator)
- **class-variance-authority** + **clsx** + **tailwind-merge**
- **lucide-react** (иконки)

## Storybook

```bash
pnpm --filter @platform/ui storybook
```
