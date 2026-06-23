import * as React from 'react';
import type { LucideIcon } from 'lucide-react';

import { cn } from '@platform/ui/lib/utils';

/**
 * Общее пустое состояние для списков/таблиц/вкладок.
 * Сводит инлайн-варианты (dashboard/lessons, admin/topups, admin/materials,
 * students/student-dynamic-tab) к одному компоненту.
 *
 * icon — lucide-компонент (напр. `Inbox`) или готовый ReactNode.
 * Семантические токены, центрирование, паддинг как в существующих экранах.
 */
export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon?: LucideIcon | React.ReactNode;
  title: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-3 py-12 text-center text-muted-foreground',
        className,
      )}
    >
      {renderIcon(icon)}
      <p className="text-sm font-medium text-foreground">{title}</p>
      {description ? <p className="max-w-xs text-sm">{description}</p> : null}
      {action ? <div className="mt-1">{action}</div> : null}
    </div>
  );
}

/** Принять как lucide-компонент (рисуем сами с базовыми классами), так и готовый узел. */
function renderIcon(icon?: LucideIcon | React.ReactNode): React.ReactNode {
  if (!icon) return null;
  if (typeof icon === 'function') {
    const Icon = icon as LucideIcon;
    return <Icon className="size-10 opacity-50" aria-hidden />;
  }
  return icon;
}
