/**
 * Divider — Атом
 * Atomic level: Atom
 *
 * Токены: --color-border-subtle, --color-border-default
 * Nothing Phone: 1px строгий разделитель без декора
 */
import React from 'react';

export interface DividerProps {
  orientation?: 'horizontal' | 'vertical';
  strength?: 'subtle' | 'default' | 'strong';
  spacing?: 'sm' | 'md' | 'lg';
  style?: React.CSSProperties;
}

const strengthMap: Record<NonNullable<DividerProps['strength']>, string> = {
  subtle:  'var(--color-border-subtle)',
  default: 'var(--color-border-default)',
  strong:  'var(--color-border-strong)',
};

const spacingMap: Record<NonNullable<DividerProps['spacing']>, string> = {
  sm: 'var(--space-3)',
  md: 'var(--space-6)',
  lg: 'var(--space-8)',
};

export function Divider({
  orientation = 'horizontal',
  strength = 'default',
  spacing = 'md',
  style,
}: DividerProps) {
  const color = strengthMap[strength];
  const margin = spacingMap[spacing];

  if (orientation === 'vertical') {
    return (
      <div
        role="separator"
        aria-orientation="vertical"
        style={{
          display: 'inline-block',
          width: 1,
          alignSelf: 'stretch',
          background: color,
          marginInline: margin,
          flexShrink: 0,
          ...style,
        }}
      />
    );
  }

  return (
    <hr
      role="separator"
      style={{
        border: 'none',
        borderTop: `1px solid ${color}`,
        marginBlock: margin,
        ...style,
      }}
    />
  );
}
