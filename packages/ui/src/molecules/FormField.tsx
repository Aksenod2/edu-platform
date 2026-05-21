/**
 * FormField — Молекула (shadcn Form migration)
 * Atomic level: Molecule
 *
 * Обёртка над shadcn Label + shadcn Input (через атомы Label / Input),
 * опционально Select.
 * Поддерживает slot-подход через children для нестандартных контролов.
 *
 * Nothing Phone: uppercase лейблы, dark bg, тонкая border, dot-matrix hint.
 * Состояния: default, error, disabled.
 */
import React from 'react';
import { Label } from '../atoms/Label';
import { Input, type InputProps } from '../atoms/Input';
import { Text } from '../atoms/Typography';
import { cn } from '../lib/utils';

export interface FormFieldProps {
  label?: string;
  hint?: string;
  error?: string;
  required?: boolean;
  disabled?: boolean;
  id: string;
  inputProps?: Omit<InputProps, 'id' | 'error' | 'disabled'>;
  className?: string;
  children?: React.ReactNode;
}

export function FormField({
  label,
  hint,
  error,
  required,
  disabled,
  id,
  inputProps,
  className,
  children,
}: FormFieldProps) {
  const hasError = Boolean(error);

  return (
    <div className={cn('flex flex-col gap-2', className)}>
      {label && (
        <Label htmlFor={id} required={required} disabled={disabled}>
          {label}
        </Label>
      )}

      {children ?? (
        <Input
          id={id}
          error={hasError}
          disabled={disabled}
          {...inputProps}
        />
      )}

      {(hint || error) && (
        <Text
          size="xs"
          color={hasError ? 'var(--color-error)' : 'tertiary'}
          className="leading-[var(--leading-snug)]"
        >
          {error ?? hint}
        </Text>
      )}
    </div>
  );
}
