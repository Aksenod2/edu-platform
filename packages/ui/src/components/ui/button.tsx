/**
 * shadcn/ui Button primitive
 * Source: https://ui.shadcn.com/docs/components/button (new-york style)
 * Adapted for Nothing Phone design tokens.
 */
import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../../lib/utils';

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap text-sm font-medium uppercase tracking-wider transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--color-accent-red)] disabled:pointer-events-none disabled:opacity-40 [&_svg]:pointer-events-none [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        default:
          'bg-[var(--color-accent-red)] text-[var(--color-text-primary)] border border-[var(--color-accent-red)] hover:opacity-85',
        destructive:
          'bg-[var(--color-error-dim)] text-[var(--color-error)] border border-[var(--color-error)] hover:opacity-85',
        outline:
          'border border-[var(--color-border-strong)] bg-transparent text-[var(--color-text-primary)] hover:bg-[var(--color-bg-elevated)]',
        ghost:
          'bg-transparent border border-transparent text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-elevated)] hover:text-[var(--color-text-primary)]',
        link: 'text-[var(--color-accent-red)] underline-offset-4 hover:underline',
      },
      size: {
        default: 'h-9 px-5 py-2 text-sm',
        sm: 'h-7 px-3 text-xs',
        lg: 'h-11 px-8 text-base',
        icon: 'h-9 w-9',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
);

export interface ShadcnButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const ShadcnButton = React.forwardRef<HTMLButtonElement, ShadcnButtonProps>(
  ({ className, variant, size, ...props }, ref) => {
    return (
      <button
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    );
  },
);
ShadcnButton.displayName = 'ShadcnButton';

export { ShadcnButton, buttonVariants };
