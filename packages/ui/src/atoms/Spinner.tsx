/**
 * Spinner — Атом
 * Atomic level: Atom
 *
 * Мигрирован на Tailwind v4 animate-spin (CMP-226).
 * Убрана зависимость от np-spin keyframe.
 * Размеры: sm (16px), md (24px), lg (40px)
 *
 * Nothing Phone: геометрическая вращающаяся окружность, нет мягкости
 */
import React from 'react';
import { cn } from '../lib/utils';

export type SpinnerSize = 'sm' | 'md' | 'lg';

export interface SpinnerProps {
  size?: SpinnerSize;
  /** Цвет акцентной дуги (CSS color). По умолчанию — var(--color-accent-red). */
  color?: string;
  label?: string;
  className?: string;
}

const sizeClasses: Record<SpinnerSize, string> = {
  sm: 'size-4',   // 16px
  md: 'size-6',   // 24px
  lg: 'size-10',  // 40px
};

const strokeClasses: Record<SpinnerSize, string> = {
  sm: 'border-2',
  md: 'border-2',
  lg: 'border-[3px]',
};

export function Spinner({ size = 'md', color, label = 'Загрузка...', className }: SpinnerProps) {
  return (
    <span
      role="status"
      aria-label={label}
      className={cn(
        'inline-flex items-center justify-center shrink-0',
        sizeClasses[size],
        className,
      )}
    >
      <span
        className={cn(
          'block rounded-full animate-spin',
          'border-border-default',
          sizeClasses[size],
          strokeClasses[size],
        )}
        style={
          color
            ? { borderTopColor: color }
            : { borderTopColor: 'var(--color-accent-red)' }
        }
      />
    </span>
  );
}
