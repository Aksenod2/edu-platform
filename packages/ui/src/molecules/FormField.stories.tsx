/**
 * FormField — Молекула
 * Atomic Design: Molecule
 *
 * Обёртка Label + Input (shadcn-backed atoms).
 * Nothing Phone: uppercase лейблы, тёмные инпуты.
 */
import type { Meta, StoryObj } from '@storybook/react';
import { FormField } from './FormField';

const meta: Meta<typeof FormField> = {
  title: 'Molecules/FormField',
  component: FormField,
  tags: ['autodocs'],
};

export default meta;
type Story = StoryObj<typeof FormField>;

export const Default: Story = {
  args: { label: 'EMAIL', id: 'email', inputProps: { placeholder: 'name@example.com' } },
  decorators: [(Story) => <div className="w-80"><Story /></div>],
};

export const WithHint: Story = {
  args: {
    label: 'USERNAME',
    id: 'username',
    hint: 'Только латинские буквы и цифры',
    inputProps: { placeholder: 'john_doe' },
  },
  decorators: [(Story) => <div className="w-80"><Story /></div>],
};

export const WithError: Story = {
  args: { label: 'ПАРОЛЬ', id: 'password', error: 'Минимум 8 символов', inputProps: { type: 'password' } },
  decorators: [(Story) => <div className="w-80"><Story /></div>],
};

export const Disabled: Story = {
  args: {
    label: 'EMAIL',
    id: 'email-disabled',
    disabled: true,
    inputProps: { placeholder: 'name@example.com', value: 'readonly@example.com' },
  },
  decorators: [(Story) => <div className="w-80"><Story /></div>],
};

export const LoginForm: Story = {
  render: () => (
    <div className="w-80 flex flex-col gap-4">
      <FormField label="EMAIL" id="email-demo" inputProps={{ placeholder: 'name@example.com' }} />
      <FormField label="ПАРОЛЬ" id="password-demo" inputProps={{ type: 'password', placeholder: '••••••••' }} />
    </div>
  ),
};
