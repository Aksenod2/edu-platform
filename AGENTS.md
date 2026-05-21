<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

<!-- BEGIN:ui-system-rules -->
# UI Components — shadcn/ui (raw, no wrappers)

## The Rule
**Use shadcn/ui components directly. Do NOT use `@platform/ui` atoms/molecules.**

## How to add components

Always install via CLI before using:
```bash
npx shadcn@latest add <component-name> -c apps/web
```

Then import from `@/components/ui/<component>`:
```tsx
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
```

## Currently installed (apps/web/src/components/ui/)
- button, input, label, card, alert, form

## Discover more components
```bash
npx shadcn@latest search <query> -c apps/web   # find components
npx shadcn@latest docs <component> -c apps/web  # read docs
```

## What stays from @platform/ui
- `AuthLayout` from `@platform/ui/templates` — keep using it (it's just a layout wrapper, not a component)
- `DashboardLayout` from `@platform/ui/templates` — keep using it
- Design tokens (CSS variables like `--color-*`, `--spacing-*`) still work alongside shadcn

## What to STOP using
- `@platform/ui/atoms` (Button, Input, FormField, etc.) — replaced by shadcn/ui
- `@platform/ui/molecules` (FormField, Card, etc.) — replaced by shadcn/ui
- Storybook — not needed; use `npx shadcn@latest docs` or `npx shadcn@latest view` instead

## Pattern for forms
```tsx
<div className="flex flex-col gap-2">
  <Label htmlFor="email">Email</Label>
  <Input id="email" type="email" placeholder="name@example.com" />
</div>
```

## Pattern for errors
```tsx
<Alert variant="destructive">
  <AlertDescription>{error}</AlertDescription>
</Alert>
```
<!-- END:ui-system-rules -->
