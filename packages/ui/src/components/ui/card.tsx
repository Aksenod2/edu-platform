/**
 * shadcn/ui Card primitives
 * Source: https://ui.shadcn.com/docs/components/card (new-york style)
 * Adapted for Nothing Phone design tokens.
 */
import * as React from 'react';
import { cn } from '../../lib/utils';

const ShadcnCard = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn(
      'rounded-[var(--radius-xs)] border border-[var(--color-border-default)] bg-[var(--color-bg-surface)] text-[var(--color-text-primary)]',
      className,
    )}
    {...props}
  />
));
ShadcnCard.displayName = 'ShadcnCard';

const ShadcnCardHeader = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn('flex flex-col gap-1.5 p-6', className)}
    {...props}
  />
));
ShadcnCardHeader.displayName = 'ShadcnCardHeader';

const ShadcnCardTitle = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn('font-semibold leading-none tracking-tight', className)}
    {...props}
  />
));
ShadcnCardTitle.displayName = 'ShadcnCardTitle';

const ShadcnCardDescription = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn('text-sm text-[var(--color-text-secondary)]', className)}
    {...props}
  />
));
ShadcnCardDescription.displayName = 'ShadcnCardDescription';

const ShadcnCardContent = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div ref={ref} className={cn('p-6 pt-0', className)} {...props} />
));
ShadcnCardContent.displayName = 'ShadcnCardContent';

const ShadcnCardFooter = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn('flex items-center p-6 pt-0', className)}
    {...props}
  />
));
ShadcnCardFooter.displayName = 'ShadcnCardFooter';

export {
  ShadcnCard,
  ShadcnCardHeader,
  ShadcnCardTitle,
  ShadcnCardDescription,
  ShadcnCardContent,
  ShadcnCardFooter,
};
