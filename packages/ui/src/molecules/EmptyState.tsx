/**
 * EmptyState — Молекула
 * Atomic level: Molecule
 *
 * Состав: иконка/иллюстрация + Heading (атом) + Text (атом) + Button (атом, опц.)
 * Токены: spacing, --color-text-tertiary
 *
 * Nothing Phone: dot-matrix иконка-заглушка, центрированная пустота,
 * минимум слов — максимум смысла (Recognition over Recall)
 *
 * Важно: empty state = такой же уровень качества, как happy path
 */
import React from 'react';
import { Heading, Text } from '../atoms/Typography';
import { Button } from '../atoms/Button';

export interface EmptyStateProps {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: {
    label: string;
    onClick: () => void;
  };
  size?: 'sm' | 'md' | 'lg';
  style?: React.CSSProperties;
}

const sizeMap = {
  sm: { iconSize: 32, gap: 'var(--space-3)', padding: 'var(--space-8)' },
  md: { iconSize: 48, gap: 'var(--space-4)', padding: 'var(--space-12)' },
  lg: { iconSize: 64, gap: 'var(--space-6)', padding: 'var(--space-16)' },
};

export function EmptyState({
  icon,
  title,
  description,
  action,
  size = 'md',
  style,
}: EmptyStateProps) {
  const { iconSize, gap, padding } = sizeMap[size];

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap,
        padding,
        textAlign: 'center',
        ...style,
      }}
    >
      {icon ? (
        <span
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: iconSize,
            height: iconSize,
            color: 'var(--color-text-tertiary)',
          }}
        >
          {icon}
        </span>
      ) : (
        <DotMatrixPlaceholder size={iconSize} />
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', maxWidth: 320 }}>
        <Heading level={3} size={size === 'lg' ? 'xl' : size === 'sm' ? 'md' : 'lg'}>
          {title}
        </Heading>
        {description && (
          <Text size="sm" color="tertiary">
            {description}
          </Text>
        )}
      </div>

      {action && (
        <Button variant="secondary" size={size === 'sm' ? 'sm' : 'md'} onClick={action.onClick}>
          {action.label}
        </Button>
      )}
    </div>
  );
}

// Dot-matrix заглушка — Nothing Phone фирменный паттерн
function DotMatrixPlaceholder({ size }: { size: number }) {
  const cols = 5;
  const rows = 5;
  const dotSize = Math.floor(size / (cols * 2));
  const gap = dotSize;

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: `repeat(${cols}, ${dotSize}px)`,
        gap,
      }}
      aria-hidden
    >
      {Array.from({ length: cols * rows }).map((_, i) => (
        <span
          key={i}
          style={{
            width: dotSize,
            height: dotSize,
            borderRadius: '50%',
            background: 'var(--color-border-strong)',
            opacity: Math.random() > 0.5 ? 1 : 0.3,
          }}
        />
      ))}
    </div>
  );
}
