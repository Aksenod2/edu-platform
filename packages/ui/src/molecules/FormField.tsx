/**
 * FormField — Молекула
 * Atomic level: Molecule
 *
 * Состав: Label (атом) + Input (атом) + описание/ошибка (Text атом)
 * Токены: spacing, color-error, color-text-secondary
 * Состояния: default, error, disabled
 *
 * Nothing Phone: чёткая иерархия label → input → hint
 */
import React from 'react';
import { Label } from '../atoms/Label';
import { Input, type InputProps } from '../atoms/Input';
import { Text } from '../atoms/Typography';

export interface FormFieldProps {
  label?: string;
  hint?: string;
  error?: string;
  required?: boolean;
  disabled?: boolean;
  id: string;
  inputProps?: Omit<InputProps, 'id' | 'error' | 'disabled'>;
  style?: React.CSSProperties;
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
  style,
  children,
}: FormFieldProps) {
  const hasError = Boolean(error);

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--space-2)',
        ...style,
      }}
    >
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
          style={{ lineHeight: 'var(--leading-snug)' }}
        >
          {error ?? hint}
        </Text>
      )}
    </div>
  );
}
