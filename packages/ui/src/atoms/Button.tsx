/**
 * Button — Атом
 * Atomic level: Atom
 *
 * Токены: --color-accent-red, --color-bg-surface, --color-border-default
 * Состояния: default, hover, active, disabled, loading
 * Варианты: primary (красный акцент), secondary (ghost), ghost (прозрачный), danger
 *
 * Nothing Phone principle: чёткие границы, нет теней, строгая геометрия
 */
import React from 'react';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  fullWidth?: boolean;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
}

const styles: Record<string, React.CSSProperties> = {
  base: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 'var(--space-2)',
    fontFamily: 'var(--font-sans)',
    fontWeight: 'var(--font-medium)' as unknown as number,
    letterSpacing: 'var(--tracking-wide)',
    textTransform: 'uppercase' as const,
    border: '1px solid transparent',
    borderRadius: 'var(--radius-xs)',
    cursor: 'pointer',
    transition: `background var(--duration-fast) var(--ease-default),
                 border-color var(--duration-fast) var(--ease-default),
                 color var(--duration-fast) var(--ease-default),
                 opacity var(--duration-fast) var(--ease-default)`,
    textDecoration: 'none',
    whiteSpace: 'nowrap' as const,
    userSelect: 'none' as const,
    position: 'relative' as const,
    overflow: 'hidden' as const,
  },
};

const sizeStyles: Record<ButtonSize, React.CSSProperties> = {
  sm: {
    fontSize: 'var(--text-xs)',
    padding: 'var(--space-2) var(--space-3)',
    height: '28px',
  },
  md: {
    fontSize: 'var(--text-sm)',
    padding: 'var(--space-2) var(--space-5)',
    height: '36px',
  },
  lg: {
    fontSize: 'var(--text-base)',
    padding: 'var(--space-3) var(--space-8)',
    height: '44px',
  },
};

const variantStyles: Record<ButtonVariant, React.CSSProperties> = {
  primary: {
    background: 'var(--color-accent-red)',
    borderColor: 'var(--color-accent-red)',
    color: 'var(--color-text-primary)',
  },
  secondary: {
    background: 'transparent',
    borderColor: 'var(--color-border-strong)',
    color: 'var(--color-text-primary)',
  },
  ghost: {
    background: 'transparent',
    borderColor: 'transparent',
    color: 'var(--color-text-secondary)',
  },
  danger: {
    background: 'var(--color-error-dim)',
    borderColor: 'var(--color-error)',
    color: 'var(--color-error)',
  },
};

export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  fullWidth = false,
  disabled,
  leftIcon,
  rightIcon,
  children,
  style,
  ...props
}: ButtonProps) {
  const isDisabled = disabled || loading;

  return (
    <button
      {...props}
      disabled={isDisabled}
      style={{
        ...styles.base,
        ...sizeStyles[size],
        ...variantStyles[variant],
        ...(fullWidth && { width: '100%' }),
        ...(isDisabled && {
          opacity: 0.38,
          cursor: 'not-allowed',
          pointerEvents: 'none',
        }),
        ...style,
      }}
    >
      {loading && <Spinner size={size === 'lg' ? 'md' : 'sm'} />}
      {!loading && leftIcon}
      {children}
      {!loading && rightIcon}
    </button>
  );
}

// Inline Spinner (used only in Button loading state)
function Spinner({ size }: { size: 'sm' | 'md' }) {
  const dim = size === 'sm' ? 12 : 16;
  return (
    <span
      style={{
        display: 'inline-block',
        width: dim,
        height: dim,
        borderRadius: '50%',
        border: '2px solid currentColor',
        borderTopColor: 'transparent',
        animation: 'np-spin 0.7s linear infinite',
        flexShrink: 0,
      }}
      aria-hidden
    />
  );
}
