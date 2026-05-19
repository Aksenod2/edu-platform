/**
 * Badge — Атом
 * Atomic level: Atom
 *
 * Токены: --color-accent-red, --color-accent-neon, semantic colors
 * Состояния: default, dot
 * Варианты: default, success, warning, error, info, accent
 *
 * Nothing Phone: монохромная основа, точечный цвет = сигнал
 */
import React from 'react';

export type BadgeVariant = 'default' | 'success' | 'warning' | 'error' | 'info' | 'accent';

export interface BadgeProps {
  variant?: BadgeVariant;
  dot?: boolean;
  children?: React.ReactNode;
  style?: React.CSSProperties;
}

const variantStyles: Record<BadgeVariant, { bg: string; color: string; border: string }> = {
  default: {
    bg: 'var(--color-bg-elevated)',
    color: 'var(--color-text-secondary)',
    border: 'var(--color-border-default)',
  },
  success: {
    bg: 'var(--color-success-dim)',
    color: 'var(--color-success)',
    border: 'transparent',
  },
  warning: {
    bg: 'var(--color-warning-dim)',
    color: 'var(--color-warning)',
    border: 'transparent',
  },
  error: {
    bg: 'var(--color-error-dim)',
    color: 'var(--color-error)',
    border: 'transparent',
  },
  info: {
    bg: 'var(--color-info-dim)',
    color: 'var(--color-info)',
    border: 'transparent',
  },
  accent: {
    bg: 'var(--color-accent-red)',
    color: '#FFFFFF',
    border: 'transparent',
  },
};

export function Badge({ variant = 'default', dot = false, children, style }: BadgeProps) {
  const v = variantStyles[variant];

  if (dot) {
    return (
      <span
        style={{
          display: 'inline-block',
          width: 6,
          height: 6,
          borderRadius: '50%',
          background: v.color,
          ...style,
        }}
        aria-hidden
      />
    );
  }

  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 'var(--space-1)',
        padding: '2px var(--space-2)',
        fontFamily: 'var(--font-mono)',
        fontSize: 'var(--text-xs)',
        fontWeight: 700,
        letterSpacing: 'var(--tracking-wider)',
        textTransform: 'uppercase',
        borderRadius: 'var(--radius-xs)',
        border: `1px solid ${v.border}`,
        background: v.bg,
        color: v.color,
        whiteSpace: 'nowrap',
        ...style,
      }}
    >
      {children}
    </span>
  );
}
