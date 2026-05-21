/**
 * Badge — Атом
 * Atomic level: Atom
 *
 * Мигрирован на shadcn/Tailwind v4 (CMP-226).
 * Токены через @theme: bg-bg-elevated, text-success, etc.
 * Варианты: default, success, warning, error, info, accent
 * Dot-mode: inline индикатор состояния (6px circle)
 *
 * Nothing Phone: монохромная основа, точечный цвет = сигнал
 */
import React from 'react';
import { cn } from '../lib/utils';

export type BadgeVariant = 'default' | 'success' | 'warning' | 'error' | 'info' | 'accent';

export interface BadgeProps {
  variant?: BadgeVariant;
  dot?: boolean;
  children?: React.ReactNode;
  className?: string;
  /** @deprecated Используй className; оставлен для обратной совместимости */
  style?: React.CSSProperties;
}

const variantClasses: Record<BadgeVariant, string> = {
  default: 'bg-bg-elevated text-text-secondary border-border-default',
  success:  'bg-success-dim text-success border-transparent',
  warning:  'bg-warning-dim text-warning border-transparent',
  error:    'bg-error-dim text-error border-transparent',
  info:     'bg-info-dim text-info border-transparent',
  accent:   'bg-accent-red text-text-inverse border-transparent',
};

const dotColorClasses: Record<BadgeVariant, string> = {
  default: 'bg-text-secondary',
  success: 'bg-success',
  warning: 'bg-warning',
  error:   'bg-error',
  info:    'bg-info',
  accent:  'bg-accent-red',
};

export function Badge({
  variant = 'default',
  dot = false,
  children,
  className,
  style,
}: BadgeProps) {
  if (dot) {
    return (
      <span
        className={cn(
          'inline-block rounded-full shrink-0',
          'w-[6px] h-[6px]',
          dotColorClasses[variant],
          className,
        )}
        style={style}
        aria-hidden
      />
    );
  }

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1',
        'px-2 py-0.5',
        'font-mono text-xs font-bold tracking-wider uppercase',
        'rounded-xs border whitespace-nowrap',
        variantClasses[variant],
        className,
      )}
      style={style}
    >
      {children}
    </span>
  );
}
