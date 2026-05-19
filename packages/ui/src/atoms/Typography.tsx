/**
 * Typography — Атом
 * Atomic level: Atom
 *
 * Токены: --font-sans, --font-mono, типографическая шкала
 * Компоненты: Heading (h1-h4), Text, Mono
 *
 * Nothing Phone typography principles:
 * - Headings: Space Grotesk, tight leading, строгая иерархия
 * - Body: Space Grotesk, relaxed
 * - Mono: Space Mono — dot-matrix эффект для акцентов, кодов, меток
 */
import React from 'react';

// ─── Heading ───────────────────────────────────────────

type HeadingLevel = 1 | 2 | 3 | 4;

export interface HeadingProps {
  level?: HeadingLevel;
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl' | '2xl' | '3xl' | '4xl';
  weight?: 'light' | 'regular' | 'medium' | 'semibold' | 'bold';
  color?: string;
  children: React.ReactNode;
  style?: React.CSSProperties;
}

const headingDefaults: Record<HeadingLevel, { size: HeadingProps['size']; weight: HeadingProps['weight'] }> = {
  1: { size: '3xl', weight: 'bold' },
  2: { size: '2xl', weight: 'semibold' },
  3: { size: 'xl',  weight: 'semibold' },
  4: { size: 'lg',  weight: 'medium' },
};

const sizeToVar: Record<NonNullable<HeadingProps['size']>, string> = {
  xs:  'var(--text-xs)',
  sm:  'var(--text-sm)',
  md:  'var(--text-base)',
  lg:  'var(--text-lg)',
  xl:  'var(--text-xl)',
  '2xl': 'var(--text-2xl)',
  '3xl': 'var(--text-3xl)',
  '4xl': 'var(--text-4xl)',
};

const weightToVar: Record<NonNullable<HeadingProps['weight']>, string> = {
  light:    'var(--font-light)',
  regular:  'var(--font-regular)',
  medium:   'var(--font-medium)',
  semibold: 'var(--font-semibold)',
  bold:     'var(--font-bold)',
};

export function Heading({ level = 2, size, weight, color, children, style }: HeadingProps) {
  const defaults = headingDefaults[level];
  const resolvedSize = size ?? defaults.size!;
  const resolvedWeight = weight ?? defaults.weight!;

  const headingStyle: React.CSSProperties = {
    fontFamily: 'var(--font-sans)',
    fontSize: sizeToVar[resolvedSize],
    fontWeight: weightToVar[resolvedWeight],
    lineHeight: 'var(--leading-tight)',
    letterSpacing: 'var(--tracking-tight)',
    color: color ?? 'var(--color-text-primary)',
    ...style,
  };

  if (level === 1) return <h1 style={headingStyle}>{children}</h1>;
  if (level === 2) return <h2 style={headingStyle}>{children}</h2>;
  if (level === 3) return <h3 style={headingStyle}>{children}</h3>;
  return <h4 style={headingStyle}>{children}</h4>;
}

// ─── Text ───────────────────────────────────────────────

export interface TextProps {
  size?: 'xs' | 'sm' | 'base' | 'lg';
  color?: 'primary' | 'secondary' | 'tertiary' | 'disabled' | string;
  weight?: HeadingProps['weight'];
  as?: 'p' | 'span' | 'div' | 'li';
  children: React.ReactNode;
  style?: React.CSSProperties;
}

const colorMap: Record<string, string> = {
  primary:   'var(--color-text-primary)',
  secondary: 'var(--color-text-secondary)',
  tertiary:  'var(--color-text-tertiary)',
  disabled:  'var(--color-text-disabled)',
};

const textSizeMap: Record<NonNullable<TextProps['size']>, string> = {
  xs:   'var(--text-xs)',
  sm:   'var(--text-sm)',
  base: 'var(--text-base)',
  lg:   'var(--text-lg)',
};

export function Text({
  size = 'base',
  color = 'secondary',
  weight = 'regular',
  as: Tag = 'p',
  children,
  style,
}: TextProps) {
  return (
    <Tag
      style={{
        fontFamily: 'var(--font-sans)',
        fontSize: textSizeMap[size],
        fontWeight: weightToVar[weight],
        lineHeight: 'var(--leading-normal)',
        color: colorMap[color] ?? color,
        ...style,
      }}
    >
      {children}
    </Tag>
  );
}

// ─── Mono ───────────────────────────────────────────────
// Dot-matrix акцент — для кодов, ID, меток, статусных строк

export interface MonoProps {
  size?: 'xs' | 'sm' | 'base';
  color?: string;
  children: React.ReactNode;
  as?: 'span' | 'p' | 'code' | 'div';
  style?: React.CSSProperties;
}

const monoSizeMap: Record<NonNullable<MonoProps['size']>, string> = {
  xs:   'var(--text-xs)',
  sm:   'var(--text-sm)',
  base: 'var(--text-base)',
};

export function Mono({ size = 'sm', color, children, as: Tag = 'span', style }: MonoProps) {
  return (
    <Tag
      style={{
        fontFamily: 'var(--font-mono)',
        fontSize: monoSizeMap[size],
        letterSpacing: 'var(--tracking-wide)',
        color: color ?? 'var(--color-text-secondary)',
        ...style,
      }}
    >
      {children}
    </Tag>
  );
}
