/**
 * Select — Атом
 * Atomic level: Atom
 *
 * Стилизованный dropdown, консистентный с Input.
 * Токены: --color-bg-surface, --color-border-default, --color-text-primary
 * Состояния: default, focus, error, disabled
 *
 * Nothing Phone: строгий прямоугольник, 1px граница, красный focus ring
 */
import React from 'react';

export type SelectSize = 'sm' | 'md' | 'lg';

export interface SelectProps extends Omit<React.SelectHTMLAttributes<HTMLSelectElement>, 'size'> {
  size?: SelectSize;
  error?: boolean;
  fullWidth?: boolean;
  placeholder?: string;
}

const sizeMap: Record<SelectSize, { height: string; fontSize: string; padding: string }> = {
  sm: { height: '28px', fontSize: 'var(--text-sm)', padding: '0 var(--space-8) 0 var(--space-3)' },
  md: { height: '36px', fontSize: 'var(--text-base)', padding: '0 var(--space-8) 0 var(--space-4)' },
  lg: { height: '44px', fontSize: 'var(--text-base)', padding: '0 var(--space-10) 0 var(--space-5)' },
};

export function Select({
  size = 'md',
  error = false,
  fullWidth = true,
  disabled,
  style,
  children,
  ...props
}: SelectProps) {
  const { height, fontSize, padding } = sizeMap[size];

  return (
    <div style={{
      position: 'relative',
      display: 'inline-flex',
      width: fullWidth ? '100%' : 'auto',
    }}>
      <select
        {...props}
        disabled={disabled}
        style={{
          height,
          fontSize,
          padding,
          fontFamily: 'var(--font-sans)',
          background: 'var(--color-bg-surface)',
          border: `1px solid ${error ? 'var(--color-error)' : 'var(--color-border-default)'}`,
          borderRadius: 'var(--radius-xs)',
          color: 'var(--color-text-primary)',
          outline: 'none',
          transition: 'border-color var(--duration-fast) var(--ease-default)',
          appearance: 'none',
          cursor: disabled ? 'not-allowed' : 'pointer',
          width: '100%',
          ...(disabled && { opacity: 0.38 }),
          ...style,
        }}
      >
        {children}
      </select>
      {/* Chevron */}
      <span
        style={{
          position: 'absolute',
          right: 'var(--space-3)',
          top: '50%',
          transform: 'translateY(-50%)',
          pointerEvents: 'none',
          color: 'var(--color-text-tertiary)',
          display: 'flex',
        }}
        aria-hidden
      >
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 4.5L6 7.5L9 4.5" />
        </svg>
      </span>
    </div>
  );
}
