/**
 * shadcn/ui Input primitive
 * Source: https://ui.shadcn.com/docs/components/input (new-york style)
 * Adapted for Nothing Phone design tokens.
 */
import * as React from 'react';
import { cn } from '../../lib/utils';

export interface ShadcnInputProps extends React.InputHTMLAttributes<HTMLInputElement> {}

const ShadcnInput = React.forwardRef<HTMLInputElement, ShadcnInputProps>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          'flex h-9 w-full border border-[var(--color-border-default)] bg-[var(--color-bg-surface)] px-4 py-1 text-base font-[var(--font-sans)] text-[var(--color-text-primary)] shadow-none transition-colors placeholder:text-[var(--color-text-tertiary)] focus-visible:outline-none focus-visible:border-[var(--color-accent-red)] focus-visible:ring-1 focus-visible:ring-[var(--color-accent-red)] disabled:cursor-not-allowed disabled:opacity-40 md:text-sm',
          className,
        )}
        ref={ref}
        {...props}
      />
    );
  },
);
ShadcnInput.displayName = 'ShadcnInput';

export { ShadcnInput };
