/**
 * Design Tokens — TypeScript mirror of tokens.css
 * Атомарный уровень: N/A (foundational layer)
 *
 * Используй CSS custom properties в компонентах, этот модуль — для JS-логики
 * (e.g. charts, canvas, animations, dynamic styles)
 */

export const colors = {
  bg: {
    base:     '#000000',
    surface:  '#0D0D0D',
    elevated: '#161616',
    overlay:  '#1F1F1F',
  },
  border: {
    subtle:  '#1A1A1A',
    default: '#2A2A2A',
    strong:  '#404040',
  },
  text: {
    primary:   '#FFFFFF',
    secondary: '#A0A0A0',
    tertiary:  '#606060',
    disabled:  '#3A3A3A',
    inverse:   '#000000',
  },
  accent: {
    red:      '#FF0000',
    redDim:   'rgba(255, 0, 0, 0.12)',
    redGlow:  'rgba(255, 0, 0, 0.24)',
    neon:     '#39FF14',
    neonDim:  'rgba(57, 255, 20, 0.10)',
  },
  semantic: {
    success:     '#39FF14',
    successDim:  'rgba(57, 255, 20, 0.10)',
    warning:     '#FFB800',
    warningDim:  'rgba(255, 184, 0, 0.10)',
    error:       '#FF0000',
    errorDim:    'rgba(255, 0, 0, 0.10)',
    info:        '#4DA6FF',
    infoDim:     'rgba(77, 166, 255, 0.10)',
  },
} as const;

export const fonts = {
  sans: "'Space Grotesk', system-ui, -apple-system, sans-serif",
  mono: "'Space Mono', 'Courier New', monospace",
} as const;

export const textScale = {
  xs:   '0.64rem',
  sm:   '0.8rem',
  base: '1rem',
  lg:   '1.25rem',
  xl:   '1.563rem',
  '2xl': '1.953rem',
  '3xl': '2.441rem',
  '4xl': '3.052rem',
} as const;

export const spacing = {
  0:  '0',
  1:  '0.25rem',
  2:  '0.5rem',
  3:  '0.75rem',
  4:  '1rem',
  5:  '1.25rem',
  6:  '1.5rem',
  8:  '2rem',
  10: '2.5rem',
  12: '3rem',
  16: '4rem',
  20: '5rem',
  24: '6rem',
  32: '8rem',
} as const;

export const radius = {
  none: '0',
  xs:   '2px',
  sm:   '4px',
  md:   '6px',
  lg:   '8px',
  xl:   '12px',
  full: '9999px',
} as const;

export const duration = {
  instant: 0,
  fast:    100,
  normal:  200,
  slow:    350,
} as const;

/** Токены для передачи в стили (строки CSS var) */
export const t = {
  // Colors
  bgBase:        'var(--color-bg-base)',
  bgSurface:     'var(--color-bg-surface)',
  bgElevated:    'var(--color-bg-elevated)',
  borderDefault: 'var(--color-border-default)',
  textPrimary:   'var(--color-text-primary)',
  textSecondary: 'var(--color-text-secondary)',
  accentRed:     'var(--color-accent-red)',
  accentNeon:    'var(--color-accent-neon)',
  // Spacing helpers
  s1: 'var(--space-1)',
  s2: 'var(--space-2)',
  s3: 'var(--space-3)',
  s4: 'var(--space-4)',
  s6: 'var(--space-6)',
  s8: 'var(--space-8)',
} as const;
