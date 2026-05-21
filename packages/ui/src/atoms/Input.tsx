/**
 * Input — Атом (обёртка над shadcn Input)
 * Atomic level: Atom
 *
 * Сохраняет исходный prop API (size, error, leftElement, rightElement, fullWidth).
 * Внутри использует shadcn/ui Input с Tailwind-классами.
 *
 * Состояния error передаются через className (border-[var(--color-error)]).
 */
import React from 'react';
import { ShadcnInput } from '../components/ui/input';
import { cn } from '../lib/utils';

export type InputSize = 'sm' | 'md' | 'lg';

export interface InputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'size'> {
  size?: InputSize;
  error?: boolean;
  leftElement?: React.ReactNode;
  rightElement?: React.ReactNode;
  fullWidth?: boolean;
}

const sizeClass: Record<InputSize, string> = {
  sm: 'h-7 text-sm px-3',
  md: 'h-9 text-base px-4',
  lg: 'h-11 text-base px-5',
};

export function Input({
  size = 'md',
  error = false,
  leftElement,
  rightElement,
  fullWidth = true,
  disabled,
  className,
  ...props
}: InputProps) {
  const hasLeft = Boolean(leftElement);
  const hasRight = Boolean(rightElement);

  const inputClass = cn(
    sizeClass[size],
    error && 'border-[var(--color-error)] focus-visible:border-[var(--color-error)] focus-visible:ring-[var(--color-error)]',
    !fullWidth && 'w-auto',
    hasLeft && 'pl-[calc(var(--space-3,0.75rem)*2+16px)]',
    hasRight && 'pr-[calc(var(--space-3,0.75rem)*2+16px)]',
    className,
  );

  if (leftElement || rightElement) {
    return (
      <div
        style={{
          position: 'relative',
          display: 'inline-flex',
          alignItems: 'center',
          width: fullWidth ? '100%' : 'auto',
        }}
      >
        {leftElement && (
          <span
            style={{
              position: 'absolute',
              left: '0.75rem',
              color: 'var(--color-text-tertiary)',
              display: 'flex',
              alignItems: 'center',
              pointerEvents: 'none',
            }}
          >
            {leftElement}
          </span>
        )}
        <ShadcnInput disabled={disabled} className={inputClass} {...props} />
        {rightElement && (
          <span
            style={{
              position: 'absolute',
              right: '0.75rem',
              color: 'var(--color-text-tertiary)',
              display: 'flex',
              alignItems: 'center',
            }}
          >
            {rightElement}
          </span>
        )}
      </div>
    );
  }

  return <ShadcnInput disabled={disabled} className={inputClass} {...props} />;
}
