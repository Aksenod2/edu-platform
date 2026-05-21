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

  // pl-10/pr-10 = 2.5rem = 40px = calc(12px*2 + 16px icon) — equivalent to old calc(var(--space-3)*2+16px)
  const inputClass = cn(
    sizeClass[size],
    error && 'border-[var(--color-error)] focus-visible:border-[var(--color-error)] focus-visible:ring-[var(--color-error)]',
    !fullWidth && 'w-auto',
    hasLeft && 'pl-10',
    hasRight && 'pr-10',
    className,
  );

  if (leftElement || rightElement) {
    return (
      <div className={cn('relative inline-flex items-center', fullWidth ? 'w-full' : 'w-auto')}>
        {leftElement && (
          <span className="absolute left-3 flex items-center pointer-events-none text-[var(--color-text-tertiary)]">
            {leftElement}
          </span>
        )}
        <ShadcnInput disabled={disabled} className={inputClass} {...props} />
        {rightElement && (
          <span className="absolute right-3 flex items-center text-[var(--color-text-tertiary)]">
            {rightElement}
          </span>
        )}
      </div>
    );
  }

  return <ShadcnInput disabled={disabled} className={inputClass} {...props} />;
}
