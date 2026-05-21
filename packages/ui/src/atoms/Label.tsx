/**
 * Label — Атом (обёртка над shadcn Label)
 * Atomic level: Atom
 *
 * Сохраняет исходный prop API (required, disabled, size).
 * Внутри использует shadcn/ui Label (Radix LabelPrimitive) с Tailwind-классами.
 */
'use client';

import React from 'react';
import { ShadcnLabel } from '../components/ui/label';
import { cn } from '../lib/utils';

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
  className,
  ...props
}: LabelProps) {
  return (
    <ShadcnLabel
      className={cn(
        size === 'sm' ? 'text-xs' : 'text-sm',
        disabled && 'text-[var(--color-text-disabled)] cursor-default opacity-100',
        !disabled && 'text-[var(--color-text-secondary)] cursor-pointer',
        'select-none',
        className,
      )}
      {...props}
    >
      {children}
      {required && (
        <span
          aria-hidden
          style={{ color: 'var(--color-accent-red)', marginLeft: '0.25rem' }}
        >
          *
        </span>
      )}
    </ShadcnLabel>
  );
}
