/**
 * Label — Атом
 * Atomic level: Atom
 *
 * Токены: --color-text-secondary, --text-sm, --font-medium
 * Состояния: default, required, disabled
 */
import React from 'react';

export interface LabelProps extends React.LabelHTMLAttributes<HTMLLabelElement> {
  required?: boolean;
  disabled?: boolean;
  size?: 'sm' | 'md';
}

export function Label({
  required,
  disabled,
  size = 'md',
  children,
  style,
  ...props
}: LabelProps) {
  return (
    <label
      {...props}
      style={{
        display: 'block',
        fontFamily: 'var(--font-sans)',
        fontSize: size === 'sm' ? 'var(--text-xs)' : 'var(--text-sm)',
        fontWeight: 500,
        letterSpacing: 'var(--tracking-wide)',
        textTransform: 'uppercase',
        color: disabled ? 'var(--color-text-disabled)' : 'var(--color-text-secondary)',
        userSelect: 'none',
        cursor: disabled ? 'default' : 'pointer',
        ...style,
      }}
    >
      {children}
      {required && (
        <span
          aria-hidden
          style={{ color: 'var(--color-accent-red)', marginLeft: 'var(--space-1)' }}
        >
          *
        </span>
      )}
    </label>
  );
}
