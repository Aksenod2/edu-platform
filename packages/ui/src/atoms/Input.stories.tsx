/**
 * Input — Атом
 * Atomic Design: Atom
 *
 * Тёмный фон (--color-bg-surface), 1px бордер, красный focus ring.
 * Nothing Phone: строгий прямоугольник без закруглений.
 */
import type { Meta, StoryObj } from '@storybook/react';
import { Input } from './Input';

const meta: Meta<typeof Input> = {
  title: 'Atoms/Input',
  component: Input,
  tags: ['autodocs'],
  argTypes: {
    size: { control: 'select', options: ['sm', 'md', 'lg'] },
    error: { control: 'boolean' },
    disabled: { control: 'boolean' },
    placeholder: { control: 'text' },
  },
};

export default meta;
type Story = StoryObj<typeof Input>;

export const Default: Story = {
  args: { placeholder: 'name@example.com' },
  decorators: [(Story) => <div style={{ width: 320 }}><Story /></div>],
};

export const WithError: Story = {
  args: { placeholder: 'Введите email', error: true, value: 'invalid' },
  decorators: [(Story) => <div style={{ width: 320 }}><Story /></div>],
};

export const Disabled: Story = {
  args: { placeholder: 'Недоступно', disabled: true },
  decorators: [(Story) => <div style={{ width: 320 }}><Story /></div>],
};

export const Small: Story = {
  args: { size: 'sm', placeholder: 'Поиск...' },
  decorators: [(Story) => <div style={{ width: 240 }}><Story /></div>],
};

export const Large: Story = {
  args: { size: 'lg', placeholder: 'Введите название потока' },
  decorators: [(Story) => <div style={{ width: 400 }}><Story /></div>],
};

export const AllSizes: Story = {
  render: () => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, width: 320 }}>
      <Input size="sm" placeholder="Small" />
      <Input size="md" placeholder="Medium" />
      <Input size="lg" placeholder="Large" />
    </div>
  ),
};
