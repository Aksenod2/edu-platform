/**
 * Input — Атом
 * Atomic level: Atom
 *
 * Токены: --color-bg-surface, --color-border-default, --color-text-primary
 * Состояния: default, focus, error, disabled, readonly
 *
 * Nothing Phone: строгий прямоугольник, 1px граница, красный focus ring
 */
import React from 'react';

export type InputSize = 'sm' | 'md' | 'lg';

export interface InputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'size'> {
  size?: InputSize;
  error?: boolean;
  leftElement?: React.ReactNode;
  rightElement?: React.ReactNode;
  fullWidth?: boolean;
}

const sizeMap: Record<InputSize, { height: string; fontSize: string; padding: string }> = {
  sm: { height: '28px', fontSize: 'var(--text-sm)', padding: '0 var(--space-3)' },
  md: { height: '36px', fontSize: 'var(--text-base)', padding: '0 var(--space-4)' },
  lg: { height: '44px', fontSize: 'var(--text-base)', padding: '0 var(--space-5)' },
};

export function Input({
  size = 'md',
  error = false,
  leftElement,
  rightElement,
  fullWidth = true,
  disabled,
  style,
  ...props
}: InputProps) {
  const hasLeft = Boolean(leftElement);
  const hasRight = Boolean(rightElement);

  if (leftElement || rightElement) {
    return (
      <div
        style={{
          position: 'relative',
          display: 'inline-flex',
          alignItems: 'center',
          width: fullWidth ? '100%' : 'auto',
        }}
      >
        {leftElement && (
          <span
            style={{
              position: 'absolute',
              left: 'var(--space-3)',
              color: 'var(--color-text-tertiary)',
              display: 'flex',
              alignItems: 'center',
              pointerEvents: 'none',
            }}
          >
            {leftElement}
          </span>
        )}
        <input
          {...props}
          disabled={disabled}
          style={{
            ...inputBaseStyle(size, error, disabled),
            width: '100%',
            ...(hasLeft && { paddingLeft: 'calc(var(--space-3) * 2 + 16px)' }),
            ...(hasRight && { paddingRight: 'calc(var(--space-3) * 2 + 16px)' }),
            ...style,
          }}
        />
        {rightElement && (
          <span
            style={{
              position: 'absolute',
              right: 'var(--space-3)',
              color: 'var(--color-text-tertiary)',
              display: 'flex',
              alignItems: 'center',
            }}
          >
            {rightElement}
          </span>
        )}
      </div>
    );
  }

  return (
    <input
      {...props}
      disabled={disabled}
      style={{
        ...inputBaseStyle(size, error, disabled),
        ...(fullWidth && { width: '100%' }),
        ...style,
      }}
    />
  );
}

function inputBaseStyle(
  size: InputSize,
  error: boolean,
  disabled?: boolean
): React.CSSProperties {
  const { height, fontSize, padding } = sizeMap[size];
  return {
    height,
    fontSize,
    padding,
    fontFamily: 'var(--font-sans)',
    background: 'var(--color-bg-surface)',
    border: `1px solid ${error ? 'var(--color-error)' : 'var(--color-border-default)'}`,
    borderRadius: 'var(--radius-xs)',
    color: 'var(--color-text-primary)',
    outline: 'none',
    transition: 'border-color var(--duration-fast) var(--ease-default)',
    ...(disabled && {
      opacity: 0.38,
      cursor: 'not-allowed',
    }),
  };
}
