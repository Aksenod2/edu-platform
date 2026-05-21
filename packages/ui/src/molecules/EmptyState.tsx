/**
 * EmptyState — Молекула
 * Atomic level: Molecule
 *
 * Rebuilt on Tailwind CSS v4 (CMP-251).
 * Состав: иконка/иллюстрация + Heading (атом) + Text (атом) + Button (атом, опц.)
 * Токены: через @theme — text-text-tertiary, bg-border-strong, gap-*, p-*
 *
 * Nothing Phone: dot-matrix иконка-заглушка, центрированная пустота,
 * минимум слов — максимум смысла (Recognition over Recall)
 *
 * Важно: empty state = такой же уровень качества, как happy path
 */
import React from 'react';
import { cn } from '../lib/utils';
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
  className?: string;
  /** @deprecated используй className */
  style?: React.CSSProperties;
}

const sizeConfig = {
  sm: { iconSize: 32, gapClass: 'gap-3', padClass: 'p-8',  headingSize: 'md' as const },
  md: { iconSize: 48, gapClass: 'gap-4', padClass: 'p-12', headingSize: 'lg' as const },
  lg: { iconSize: 64, gapClass: 'gap-6', padClass: 'p-16', headingSize: 'xl' as const },
} satisfies Record<string, { iconSize: number; gapClass: string; padClass: string; headingSize: 'md' | 'lg' | 'xl' }>;

export function EmptyState({
  icon,
  title,
  description,
  action,
  size = 'md',
  className,
  style,
}: EmptyStateProps) {
  const { iconSize, gapClass, padClass, headingSize } = sizeConfig[size];

  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center text-center',
        gapClass,
        padClass,
        className,
      )}
      style={style}
    >
      {icon ? (
        <span
          className="flex items-center justify-center shrink-0 text-text-tertiary"
          style={{ width: iconSize, height: iconSize }}
        >
          {icon}
        </span>
      ) : (
        <DotMatrixPlaceholder size={iconSize} />
      )}

      <div className="flex flex-col gap-2 max-w-xs">
        <Heading level={3} size={headingSize}>
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
// Паттерн детерминирован (без Math.random) — безопасен для SSR и гидрации
const DOT_OPACITY: number[] = [1, 0.3, 1, 0.3, 1, 0.3, 1, 0.3, 1, 0.3, 1, 0.3, 1, 0.3, 1, 0.3, 1, 0.3, 1, 0.3, 1, 0.3, 1, 0.3, 1];

function DotMatrixPlaceholder({ size }: { size: number }) {
  const cols = 5;
  const rows = 5;
  const dotSize = Math.floor(size / (cols * 2));

  return (
    <div
      className="shrink-0"
      style={{
        display: 'grid',
        gridTemplateColumns: `repeat(${cols}, ${dotSize}px)`,
        gap: dotSize,
      }}
      aria-hidden
    >
      {Array.from({ length: cols * rows }).map((_, i) => (
        <span
          key={i}
          className="rounded-full bg-border-strong"
          style={{
            width: dotSize,
            height: dotSize,
            opacity: DOT_OPACITY[i % DOT_OPACITY.length],
          }}
        />
      ))}
    </div>
  );
}
