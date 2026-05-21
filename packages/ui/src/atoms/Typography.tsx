/**
 * Typography — Атом
 * Atomic level: Atom
 *
 * Мигрировано на Tailwind CSS v4 (CMP-225).
 * Токены: @theme в tailwind.css — font-sans, font-mono, text-*, tracking-*, leading-*
 *
 * Nothing Phone typography principles:
 * - Headings: Space Grotesk, tight leading, строгая иерархия
 * - Body: Space Grotesk, relaxed
 * - Mono: Space Mono — dot-matrix эффект для акцентов, кодов, меток
 */
import React from 'react';
import { cn } from '../lib/utils';

// ─── Heading ───────────────────────────────────────────

type HeadingLevel = 1 | 2 | 3 | 4;

export interface HeadingProps {
  level?: HeadingLevel;
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl' | '2xl' | '3xl' | '4xl';
  weight?: 'light' | 'regular' | 'medium' | 'semibold' | 'bold';
  color?: string;
  className?: string;
  children: React.ReactNode;
  style?: React.CSSProperties;
}

const headingDefaults: Record<HeadingLevel, { size: HeadingProps['size']; weight: HeadingProps['weight'] }> = {
  1: { size: '3xl', weight: 'bold' },
  2: { size: '2xl', weight: 'semibold' },
  3: { size: 'xl',  weight: 'semibold' },
  4: { size: 'lg',  weight: 'medium' },
};

const headingSizeClass: Record<NonNullable<HeadingProps['size']>, string> = {
  xs:    'text-xs',
  sm:    'text-sm',
  md:    'text-base',
  lg:    'text-lg',
  xl:    'text-xl',
  '2xl': 'text-2xl',
  '3xl': 'text-3xl',
  '4xl': 'text-4xl',
};

const weightClass: Record<NonNullable<HeadingProps['weight']>, string> = {
  light:    'font-light',
  regular:  'font-normal',
  medium:   'font-medium',
  semibold: 'font-semibold',
  bold:     'font-bold',
};

export function Heading({ level = 2, size, weight, color, className, children, style }: HeadingProps) {
  const defaults = headingDefaults[level];
  const resolvedSize = size ?? defaults.size!;
  const resolvedWeight = weight ?? defaults.weight!;

  const classes = cn(
    'font-sans',
    'leading-tight',
    'tracking-tight',
    headingSizeClass[resolvedSize],
    weightClass[resolvedWeight],
    !color && 'text-text-primary',
    className,
  );

  const inlineStyle: React.CSSProperties | undefined = color
    ? { color, ...style }
    : style;

  if (level === 1) return <h1 className={classes} style={inlineStyle}>{children}</h1>;
  if (level === 2) return <h2 className={classes} style={inlineStyle}>{children}</h2>;
  if (level === 3) return <h3 className={classes} style={inlineStyle}>{children}</h3>;
  return <h4 className={classes} style={inlineStyle}>{children}</h4>;
}

// ─── Text ───────────────────────────────────────────────

export interface TextProps {
  size?: 'xs' | 'sm' | 'base' | 'lg';
  color?: 'primary' | 'secondary' | 'tertiary' | 'disabled' | string;
  weight?: HeadingProps['weight'];
  as?: 'p' | 'span' | 'div' | 'li';
  className?: string;
  children: React.ReactNode;
  style?: React.CSSProperties;
}

const textSizeClass: Record<NonNullable<TextProps['size']>, string> = {
  xs:   'text-xs',
  sm:   'text-sm',
  base: 'text-base',
  lg:   'text-lg',
};

// Named color values → Tailwind utility classes
const textColorClass: Record<string, string> = {
  primary:   'text-text-primary',
  secondary: 'text-text-secondary',
  tertiary:  'text-text-tertiary',
  disabled:  'text-text-disabled',
};

export function Text({
  size = 'base',
  color = 'secondary',
  weight = 'regular',
  as: Tag = 'p',
  className,
  children,
  style,
}: TextProps) {
  const namedColorClass = textColorClass[color];

  const classes = cn(
    'font-sans',
    'leading-normal',
    textSizeClass[size],
    weightClass[weight],
    namedColorClass,
    className,
  );

  const inlineStyle: React.CSSProperties | undefined = namedColorClass
    ? style
    : { color, ...style };

  return (
    <Tag className={classes} style={inlineStyle}>
      {children}
    </Tag>
  );
}

// ─── Mono ───────────────────────────────────────────────
// Dot-matrix акцент — для кодов, ID, меток, статусных строк

export interface MonoProps {
  size?: 'xs' | 'sm' | 'base';
  color?: string;
  className?: string;
  children: React.ReactNode;
  as?: 'span' | 'p' | 'code' | 'div';
  style?: React.CSSProperties;
}

const monoSizeClass: Record<NonNullable<MonoProps['size']>, string> = {
  xs:   'text-xs',
  sm:   'text-sm',
  base: 'text-base',
};

export function Mono({ size = 'sm', color, className, children, as: Tag = 'span', style }: MonoProps) {
  const classes = cn(
    'font-mono',
    'tracking-wide',
    monoSizeClass[size],
    !color && 'text-text-secondary',
    className,
  );

  const inlineStyle: React.CSSProperties | undefined = color
    ? { color, ...style }
    : style;

  return (
    <Tag className={classes} style={inlineStyle}>
      {children}
    </Tag>
  );
}
