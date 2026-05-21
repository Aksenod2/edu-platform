/**
 * Divider — Атом (migrated to shadcn Separator)
 * Atomic level: Atom
 *
 * Токены: bg-border-subtle, bg-border-default, bg-border-strong (Tailwind v4)
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

const strengthClass: Record<NonNullable<DividerProps['strength']>, string> = {
  subtle:  'bg-border-subtle',
  default: 'bg-border-default',
  strong:  'bg-border-strong',
};

const spacingHClass: Record<NonNullable<DividerProps['spacing']>, string> = {
  sm: 'my-3',
  md: 'my-6',
  lg: 'my-8',
};

const spacingVClass: Record<NonNullable<DividerProps['spacing']>, string> = {
  sm: 'mx-3',
  md: 'mx-6',
  lg: 'mx-8',
};

export function Divider({
  orientation = 'horizontal',
  strength = 'default',
  spacing = 'md',
  className,
  style,
}: DividerProps) {
  const spacingClass = orientation === 'horizontal' ? spacingHClass[spacing] : spacingVClass[spacing];

  return (
    <SeparatorPrimitive.Root
      orientation={orientation}
      decorative
      className={cn(
        'shrink-0',
        orientation === 'horizontal' ? 'h-px w-full' : 'w-px self-stretch',
        strengthClass[strength],
        spacingClass,
        className,
      )}
      style={style}
    />
  );
}
