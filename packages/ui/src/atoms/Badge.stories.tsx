/**
 * Badge — Атом
 * Atomic Design: Atom
 *
 * Монохромная основа, точечный цвет = сигнал.
 * Space Mono, uppercase, tracking-wider.
 * Варианты: default, success, warning, error, info, accent.
 */
import type { Meta, StoryObj } from '@storybook/react';
import { Badge } from './Badge';

const meta: Meta<typeof Badge> = {
  title: 'Atoms/Badge',
  component: Badge,
  tags: ['autodocs'],
  argTypes: {
    variant: {
      control: 'select',
      options: ['default', 'success', 'warning', 'error', 'info', 'accent'],
    },
    dot: { control: 'boolean' },
  },
};

export default meta;
type Story = StoryObj<typeof Badge>;

export const Default: Story = {
  args: { variant: 'default', children: 'Черновик' },
};

export const Success: Story = {
  args: { variant: 'success', children: 'Активный' },
};

export const Warning: Story = {
  args: { variant: 'warning', children: 'Ожидание' },
};

export const Error: Story = {
  args: { variant: 'error', children: 'Архивный' },
};

export const Info: Story = {
  args: { variant: 'info', children: 'Проверено' },
};

export const Accent: Story = {
  args: { variant: 'accent', children: 'Новый' },
};

export const Dot: Story = {
  args: { variant: 'success', dot: true },
};

export const AllVariants: Story = {
  render: () => (
    <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
      <Badge variant="default">Default</Badge>
      <Badge variant="success">Success</Badge>
      <Badge variant="warning">Warning</Badge>
      <Badge variant="error">Error</Badge>
      <Badge variant="info">Info</Badge>
      <Badge variant="accent">Accent</Badge>
    </div>
  ),
};
