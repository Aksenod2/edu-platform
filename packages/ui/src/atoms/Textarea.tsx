/**
 * Textarea — Атом (обёртка над shadcn Textarea)
 * Atomic level: Atom
 *
 * Сохраняет исходный prop API (error, fullWidth, autoResize, maxHeight).
 * Внутри использует shadcn/ui Textarea с Tailwind-классами.
 * autoResize реализован через JS (ref + scrollHeight), как и прежде.
 */
import React, { useRef, useCallback } from 'react';
import { ShadcnTextarea } from '../components/ui/textarea';
import { cn } from '../lib/utils';

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
  className,
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
    <ShadcnTextarea
      ref={ref}
      disabled={disabled}
      onChange={handleChange}
      className={cn(
        error && 'border-[var(--color-error)] focus-visible:border-[var(--color-error)] focus-visible:ring-[var(--color-error)]',
        !fullWidth && 'w-auto',
        autoResize && 'resize-none overflow-hidden',
        className,
      )}
      {...props}
    />
  );
}
