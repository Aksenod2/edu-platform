/**
 * Card — Молекула (shadcn Card migration)
 * Atomic level: Molecule
 *
 * Состав: обёртка над shadcn Card primitives (ShadcnCardHeader /
 * ShadcnCardContent / ShadcnCardFooter) с CVA-вариантами.
 *
 * Nothing Phone эстетика: dark bg, border-subtle, dot-matrix accent.
 * Варианты: default, elevated, outlined, interactive.
 */
import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import {
  ShadcnCardHeader,
  ShadcnCardContent,
  ShadcnCardFooter,
} from '../components/ui/card';
import { cn } from '../lib/utils';

// ─── Card variants ──────────────────────────────────────

const cardVariants = cva(
  // base — Nothing Phone: sharp corners, 1px border, no shadow
  'rounded-[var(--radius-xs)] border text-[var(--color-text-primary)] transition-colors duration-[var(--duration-fast)]',
  {
    variants: {
      variant: {
        default:
          'bg-[var(--color-bg-surface)] border-[var(--color-border-default)]',
        elevated:
          'bg-[var(--color-bg-elevated)] border-[var(--color-border-default)]',
        outlined:
          'bg-transparent border-[var(--color-border-default)]',
        interactive:
          'bg-[var(--color-bg-surface)] border-[var(--color-border-default)] cursor-pointer hover:border-[var(--color-border-strong)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--color-accent-red)]',
      },
      padding: {
        none: 'p-0',
        sm:   'p-4',
        md:   'p-6',
        lg:   'p-8',
      },
    },
    defaultVariants: {
      variant: 'default',
      padding: 'md',
    },
  },
);

export type CardVariant = 'default' | 'elevated' | 'outlined' | 'interactive';

export interface CardProps
  extends Omit<React.HTMLAttributes<HTMLElement>, 'onClick'>,
    VariantProps<typeof cardVariants> {
  variant?: CardVariant;
  interactive?: boolean;
  padding?: 'none' | 'sm' | 'md' | 'lg';
  onClick?: () => void;
  as?: 'div' | 'article' | 'li';
}

export function Card({
  variant = 'default',
  interactive = false,
  padding = 'md',
  onClick,
  children,
  className,
  as: Tag = 'div',
  ...props
}: CardProps) {
  const resolvedVariant = interactive ? 'interactive' : variant;

  return (
    <Tag
      onClick={onClick}
      role={interactive ? 'button' : undefined}
      tabIndex={interactive ? 0 : undefined}
      className={cn(cardVariants({ variant: resolvedVariant, padding }), className)}
      {...(props as React.HTMLAttributes<HTMLElement>)}
    >
      {children}
    </Tag>
  );
}

// ─── CardHeader ────────────────────────────────────────

export interface CardHeaderProps {
  children: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}

export function CardHeader({ children, action, className }: CardHeaderProps) {
  return (
    <ShadcnCardHeader
      className={cn(
        'flex-row items-center justify-between gap-4 p-0 mb-4',
        className,
      )}
    >
      <div className="flex-1 min-w-0">{children}</div>
      {action && <div className="shrink-0">{action}</div>}
    </ShadcnCardHeader>
  );
}

// ─── CardBody ──────────────────────────────────────────

export interface CardBodyProps {
  children: React.ReactNode;
  className?: string;
}

export function CardBody({ children, className }: CardBodyProps) {
  return (
    <ShadcnCardContent className={cn('p-0', className)}>
      {children}
    </ShadcnCardContent>
  );
}

// ─── CardFooter ────────────────────────────────────────

export interface CardFooterProps {
  children: React.ReactNode;
  className?: string;
}

export function CardFooter({ children, className }: CardFooterProps) {
  return (
    <ShadcnCardFooter
      className={cn(
        'gap-3 p-0 mt-4 pt-4 border-t border-[var(--color-border-subtle)]',
        className,
      )}
    >
      {children}
    </ShadcnCardFooter>
  );
}
