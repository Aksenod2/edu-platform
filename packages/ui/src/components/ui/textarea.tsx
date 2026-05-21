/**
 * shadcn/ui Textarea primitive
 * Source: https://ui.shadcn.com/docs/components/textarea (new-york style)
 * Adapted for Nothing Phone design tokens.
 */
import * as React from 'react';
import { cn } from '../../lib/utils';

export interface ShadcnTextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {}

const ShadcnTextarea = React.forwardRef<HTMLTextAreaElement, ShadcnTextareaProps>(
  ({ className, ...props }, ref) => {
    return (
      <textarea
        className={cn(
          'flex min-h-[80px] w-full border border-[var(--color-border-default)] bg-[var(--color-bg-surface)] px-4 py-3 text-base font-[var(--font-sans)] text-[var(--color-text-primary)] shadow-none transition-colors placeholder:text-[var(--color-text-tertiary)] focus-visible:outline-none focus-visible:border-[var(--color-accent-red)] focus-visible:ring-1 focus-visible:ring-[var(--color-accent-red)] disabled:cursor-not-allowed disabled:opacity-40 resize-vertical md:text-sm',
          className,
        )}
        ref={ref}
        {...props}
      />
    );
  },
);
ShadcnTextarea.displayName = 'ShadcnTextarea';

export { ShadcnTextarea };
