/**
 * Divider — Атом (migrated to shadcn Separator)
 * Atomic level: Atom
 *
 * Токены: --color-border-subtle, --color-border-default, --color-border-strong
 * Nothing Phone: 1px строгий разделитель без декора
 *
 * @uses @radix-ui/react-separator (shadcn Separator primitive)
 */
import * as React from 'react';
import * as SeparatorPrimitive from '@radix-ui/react-separator';
import { cn } from '../lib/utils';

export interface DividerProps {
  orientation?: 'horizontal' | 'vertical';
  strength?: 'subtle' | 'default' | 'strong';
  spacing?: 'sm' | 'md' | 'lg';
  className?: string;
  style?: React.CSSProperties;
}

const strengthVars: Record<NonNullable<DividerProps['strength']>, string> = {
  subtle:  'var(--color-border-subtle)',
  default: 'var(--color-border-default)',
  strong:  'var(--color-border-strong)',
};

const spacingVars: Record<NonNullable<DividerProps['spacing']>, string> = {
  sm: 'var(--space-3)',
  md: 'var(--space-6)',
  lg: 'var(--space-8)',
};

export function Divider({
  orientation = 'horizontal',
  strength = 'default',
  spacing = 'md',
  className,
  style,
}: DividerProps) {
  const color = strengthVars[strength];
  const space = spacingVars[spacing];

  return (
    <SeparatorPrimitive.Root
      orientation={orientation}
      decorative
      className={cn(
        'shrink-0',
        orientation === 'horizontal' ? 'h-px w-full' : 'w-px self-stretch',
        className,
      )}
      style={{
        background: color,
        ...(orientation === 'horizontal'
          ? { marginBlock: space }
          : { marginInline: space }),
        ...style,
      }}
    />
  );
}
