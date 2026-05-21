/**
 * Button — Атом (обёртка над shadcn Button)
 * Atomic level: Atom
 *
 * Сохраняет исходный prop API (ButtonVariant, ButtonSize, loading, fullWidth, icons).
 * Внутри использует shadcn/ui Button с cva-вариантами.
 *
 * Маппинг вариантов:
 *   primary   → default (red accent)
 *   secondary → outline
 *   ghost     → ghost
 *   danger    → destructive
 */
import React from 'react';
import { ShadcnButton, buttonVariants } from '../components/ui/button';
import { cn } from '../lib/utils';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'size'> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  fullWidth?: boolean;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
}

const variantMap: Record<ButtonVariant, 'default' | 'outline' | 'ghost' | 'destructive'> = {
  primary: 'default',
  secondary: 'outline',
  ghost: 'ghost',
  danger: 'destructive',
};

const sizeMap: Record<ButtonSize, 'sm' | 'default' | 'lg'> = {
  sm: 'sm',
  md: 'default',
  lg: 'lg',
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
  className,
  ...props
}: ButtonProps) {
  const isDisabled = disabled || loading;

  return (
    <ShadcnButton
      variant={variantMap[variant]}
      size={sizeMap[size]}
      disabled={isDisabled}
      className={cn(fullWidth && 'w-full', className)}
      {...props}
    >
      {loading && <ButtonSpinner size={size === 'lg' ? 'md' : 'sm'} />}
      {!loading && leftIcon}
      {children}
      {!loading && rightIcon}
    </ShadcnButton>
  );
}

function ButtonSpinner({ size }: { size: 'sm' | 'md' }) {
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
