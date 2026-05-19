/**
 * Spinner — Атом
 * Atomic level: Atom
 *
 * Токены: --color-accent-red, --color-border-default
 * Размеры: sm (16px), md (24px), lg (40px)
 *
 * Nothing Phone: геометрическая вращающаяся окружность, нет мягкости
 */
import React from 'react';

export type SpinnerSize = 'sm' | 'md' | 'lg';

export interface SpinnerProps {
  size?: SpinnerSize;
  color?: string;
  label?: string;
}

const dimMap: Record<SpinnerSize, number> = {
  sm: 16,
  md: 24,
  lg: 40,
};

const strokeMap: Record<SpinnerSize, number> = {
  sm: 2,
  md: 2,
  lg: 3,
};

export function Spinner({ size = 'md', color, label = 'Загрузка...' }: SpinnerProps) {
  const dim = dimMap[size];
  const stroke = strokeMap[size];

  return (
    <span
      role="status"
      aria-label={label}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: dim,
        height: dim,
        flexShrink: 0,
      }}
    >
      <span
        style={{
          display: 'block',
          width: dim,
          height: dim,
          borderRadius: '50%',
          border: `${stroke}px solid var(--color-border-default)`,
          borderTopColor: color ?? 'var(--color-accent-red)',
          animation: 'np-spin 0.7s linear infinite',
        }}
      />
    </span>
  );
}

/**
 * Keyframe CSS — добавь в globals.css или tokens.css:
 *
 * @keyframes np-spin {
 *   to { transform: rotate(360deg); }
 * }
 */
