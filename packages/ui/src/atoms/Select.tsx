/**
 * Select — Атом
 * Atomic level: Atom
 *
 * Два уровня API:
 *
 * 1. Backward-compatible wrapper `<Select>` — нативный <select> с Tailwind-стилями.
 *    Все существующие страницы используют его без изменений.
 *
 * 2. Shadcn/Radix sub-компоненты — для новых форм:
 *    SelectRoot, SelectTrigger, SelectContent, SelectItem, SelectValue,
 *    SelectGroup, SelectLabel, SelectSeparator
 */
import React from 'react';
import { cn } from '../lib/utils';

// ─── Shadcn Radix-based re-exports ──────────────────────────────────────────
export {
  SelectRoot,
  SelectGroup,
  SelectValue,
  SelectTrigger,
  SelectContent,
  SelectLabel,
  SelectItem,
  SelectSeparator,
  SelectScrollUpButton,
  SelectScrollDownButton,
} from '../components/ui/select';

// ─── Native wrapper (backward compat) ───────────────────────────────────────

export type SelectSize = 'sm' | 'md' | 'lg';

export interface SelectProps extends Omit<React.SelectHTMLAttributes<HTMLSelectElement>, 'size'> {
  size?: SelectSize;
  error?: boolean;
  fullWidth?: boolean;
  placeholder?: string;
}

const sizeClass: Record<SelectSize, string> = {
  sm: 'h-7 text-sm pl-3 pr-8',
  md: 'h-9 text-base pl-4 pr-8',
  lg: 'h-11 text-base pl-5 pr-10',
};

export function Select({
  size = 'md',
  error = false,
  fullWidth = true,
  disabled,
  className,
  children,
  ...props
}: SelectProps) {
  return (
    <div
      style={{
        position: 'relative',
        display: 'inline-flex',
        width: fullWidth ? '100%' : 'auto',
      }}
    >
      <select
        disabled={disabled}
        className={cn(
          'w-full appearance-none border bg-[var(--color-bg-surface)] font-[var(--font-sans)] text-[var(--color-text-primary)] transition-colors outline-none focus-visible:border-[var(--color-accent-red)] focus-visible:ring-1 focus-visible:ring-[var(--color-accent-red)] disabled:cursor-not-allowed disabled:opacity-40',
          error
            ? 'border-[var(--color-error)]'
            : 'border-[var(--color-border-default)]',
          sizeClass[size],
          !disabled && 'cursor-pointer',
          className,
        )}
        {...props}
      >
        {children}
      </select>
      {/* Chevron */}
      <span
        style={{
          position: 'absolute',
          right: '0.75rem',
          top: '50%',
          transform: 'translateY(-50%)',
          pointerEvents: 'none',
          color: 'var(--color-text-tertiary)',
          display: 'flex',
        }}
        aria-hidden
      >
        <svg
          width="12"
          height="12"
          viewBox="0 0 12 12"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M3 4.5L6 7.5L9 4.5" />
        </svg>
      </span>
    </div>
  );
}
