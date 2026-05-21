/**
 * shadcn/ui Label primitive
 * Source: https://ui.shadcn.com/docs/components/label (new-york style)
 * Uses @radix-ui/react-label for a11y association.
 * Adapted for Nothing Phone design tokens.
 */
'use client';

import * as React from 'react';
import * as LabelPrimitive from '@radix-ui/react-label';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../../lib/utils';

const labelVariants = cva(
  'text-sm font-medium uppercase tracking-wider leading-none text-[var(--color-text-secondary)] peer-disabled:cursor-not-allowed peer-disabled:opacity-40',
);

const ShadcnLabel = React.forwardRef<
  React.ComponentRef<typeof LabelPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof LabelPrimitive.Root> & VariantProps<typeof labelVariants>
>(({ className, ...props }, ref) => (
  <LabelPrimitive.Root ref={ref} className={cn(labelVariants(), className)} {...props} />
));
ShadcnLabel.displayName = LabelPrimitive.Root.displayName;

export { ShadcnLabel };
