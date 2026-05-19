/**
 * Card — Молекула
 * Atomic level: Molecule
 *
 * Состав: контейнер с border, опционально header (Heading) + body + footer
 * Токены: --color-bg-surface, --color-border-default, --radius-sm, spacing
 * Варианты: default, elevated, outlined
 * Состояния: default, interactive (hover highlight)
 *
 * Nothing Phone: строгий прямоугольный контейнер без теней,
 * тонкая 1px граница — всё содержание говорит само за себя
 */
import React from 'react';

export type CardVariant = 'default' | 'elevated' | 'outlined';

export interface CardProps {
  variant?: CardVariant;
  interactive?: boolean;
  padding?: 'none' | 'sm' | 'md' | 'lg';
  onClick?: () => void;
  children: React.ReactNode;
  style?: React.CSSProperties;
  as?: 'div' | 'article' | 'li';
}

const variantBg: Record<CardVariant, string> = {
  default:  'var(--color-bg-surface)',
  elevated: 'var(--color-bg-elevated)',
  outlined: 'transparent',
};

const paddingMap: Record<NonNullable<CardProps['padding']>, string> = {
  none: '0',
  sm:   'var(--space-4)',
  md:   'var(--space-6)',
  lg:   'var(--space-8)',
};

export function Card({
  variant = 'default',
  interactive = false,
  padding = 'md',
  onClick,
  children,
  style,
  as: Tag = 'div',
}: CardProps) {
  return (
    <Tag
      onClick={onClick}
      role={interactive ? 'button' : undefined}
      tabIndex={interactive ? 0 : undefined}
      style={{
        background: variantBg[variant],
        border: '1px solid var(--color-border-default)',
        borderRadius: 'var(--radius-xs)',
        padding: paddingMap[padding],
        ...(interactive && {
          cursor: 'pointer',
          transition: 'border-color var(--duration-fast) var(--ease-default)',
        }),
        ...style,
      }}
    >
      {children}
    </Tag>
  );
}

// ─── Card sub-components ────────────────────────────────

export interface CardHeaderProps {
  children: React.ReactNode;
  action?: React.ReactNode;
  style?: React.CSSProperties;
}

export function CardHeader({ children, action, style }: CardHeaderProps) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 'var(--space-4)',
        marginBottom: 'var(--space-4)',
        ...style,
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>{children}</div>
      {action && <div style={{ flexShrink: 0 }}>{action}</div>}
    </div>
  );
}

export interface CardBodyProps {
  children: React.ReactNode;
  style?: React.CSSProperties;
}

export function CardBody({ children, style }: CardBodyProps) {
  return <div style={style}>{children}</div>;
}

export interface CardFooterProps {
  children: React.ReactNode;
  style?: React.CSSProperties;
}

export function CardFooter({ children, style }: CardFooterProps) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--space-3)',
        marginTop: 'var(--space-4)',
        paddingTop: 'var(--space-4)',
        borderTop: '1px solid var(--color-border-subtle)',
        ...style,
      }}
    >
      {children}
    </div>
  );
}
