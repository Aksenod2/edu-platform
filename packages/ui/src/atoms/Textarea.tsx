/**
 * Textarea — Атом
 * Atomic level: Atom
 *
 * Многострочный ввод с авто-ресайзом, консистентный с Input.
 * Токены: --color-bg-surface, --color-border-default, --color-text-primary
 * Состояния: default, focus, error, disabled
 *
 * Nothing Phone: строгий прямоугольник, 1px граница, красный focus ring
 */
import React, { useRef, useCallback } from 'react';

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  error?: boolean;
  fullWidth?: boolean;
  autoResize?: boolean;
  maxHeight?: number;
}

export function Textarea({
  error = false,
  fullWidth = true,
  autoResize = false,
  maxHeight = 200,
  disabled,
  style,
  onChange,
  ...props
}: TextareaProps) {
  const ref = useRef<HTMLTextAreaElement>(null);

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      if (autoResize && ref.current) {
        ref.current.style.height = 'auto';
        ref.current.style.height = Math.min(ref.current.scrollHeight, maxHeight) + 'px';
      }
      onChange?.(e);
    },
    [autoResize, maxHeight, onChange],
  );

  return (
    <textarea
      ref={ref}
      {...props}
      disabled={disabled}
      onChange={handleChange}
      style={{
        fontFamily: 'var(--font-sans)',
        fontSize: 'var(--text-base)',
        lineHeight: 'var(--leading-normal)',
        padding: 'var(--space-3) var(--space-4)',
        background: 'var(--color-bg-surface)',
        border: `1px solid ${error ? 'var(--color-error)' : 'var(--color-border-default)'}`,
        borderRadius: 'var(--radius-xs)',
        color: 'var(--color-text-primary)',
        outline: 'none',
        resize: autoResize ? 'none' : 'vertical',
        minHeight: 80,
        transition: 'border-color var(--duration-fast) var(--ease-default)',
        ...(fullWidth && { width: '100%' }),
        ...(disabled && {
          opacity: 0.38,
          cursor: 'not-allowed',
        }),
        ...style,
      }}
    />
  );
}
