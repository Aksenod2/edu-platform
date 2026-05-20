/**
 * FormField — Молекула
 * Atomic Design: Molecule
 *
 * Обёртка Label + Input.
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
  decorators: [(Story) => <div style={{ width: 320 }}><Story /></div>],
};

export const WithError: Story = {
  args: { label: 'ПАРОЛЬ', id: 'password', error: 'Минимум 8 символов', inputProps: { type: 'password' } },
  decorators: [(Story) => <div style={{ width: 320 }}><Story /></div>],
};

export const LoginForm: Story = {
  render: () => (
    <div style={{ width: 320, display: 'flex', flexDirection: 'column', gap: 16 }}>
      <FormField label="EMAIL" id="email-demo" inputProps={{ placeholder: 'name@example.com' }} />
      <FormField label="ПАРОЛЬ" id="password-demo" inputProps={{ type: 'password', placeholder: '••••••••' }} />
    </div>
  ),
};
