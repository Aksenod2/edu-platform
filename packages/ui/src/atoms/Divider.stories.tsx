/**
 * Divider — Атом (shadcn Separator)
 * Atomic Design: Atom
 *
 * Строгий 1px разделитель. Nothing Phone: ноль декора, только линия.
 * Варианты: horizontal / vertical, три силы цвета, три отступа.
 */
import type { Meta, StoryObj } from '@storybook/react';
import { Divider } from './Divider';

const meta: Meta<typeof Divider> = {
  title: 'Atoms/Divider',
  component: Divider,
  tags: ['autodocs'],
  argTypes: {
    orientation: { control: 'radio', options: ['horizontal', 'vertical'] },
    strength: { control: 'select', options: ['subtle', 'default', 'strong'] },
    spacing: { control: 'select', options: ['sm', 'md', 'lg'] },
  },
  parameters: {
    backgrounds: { default: 'dark' },
  },
};

export default meta;
type Story = StoryObj<typeof Divider>;

export const Horizontal: Story = {
  render: (args) => (
    <div style={{ padding: '16px', width: 320 }}>
      <p style={{ color: 'var(--color-text-secondary)', fontSize: 'var(--text-sm)' }}>
        Раздел А
      </p>
      <Divider {...args} />
      <p style={{ color: 'var(--color-text-secondary)', fontSize: 'var(--text-sm)' }}>
        Раздел Б
      </p>
    </div>
  ),
  args: { orientation: 'horizontal', strength: 'default', spacing: 'md' },
};

export const Vertical: Story = {
  render: (args) => (
    <div style={{ display: 'flex', alignItems: 'center', height: 48, padding: '0 16px' }}>
      <span style={{ color: 'var(--color-text-secondary)', fontSize: 'var(--text-sm)' }}>
        Слева
      </span>
      <Divider {...args} />
      <span style={{ color: 'var(--color-text-secondary)', fontSize: 'var(--text-sm)' }}>
        Справа
      </span>
    </div>
  ),
  args: { orientation: 'vertical', strength: 'default', spacing: 'sm' },
};

export const Subtle: Story = {
  args: { orientation: 'horizontal', strength: 'subtle', spacing: 'md' },
};

export const Strong: Story = {
  args: { orientation: 'horizontal', strength: 'strong', spacing: 'md' },
};

export const AllStrengths: Story = {
  render: () => (
    <div style={{ padding: '16px', width: 320 }}>
      <p style={{ color: 'var(--color-text-tertiary)', fontSize: 'var(--text-xs)', marginBottom: 4 }}>subtle</p>
      <Divider strength="subtle" spacing="sm" />
      <p style={{ color: 'var(--color-text-tertiary)', fontSize: 'var(--text-xs)', marginBottom: 4 }}>default</p>
      <Divider strength="default" spacing="sm" />
      <p style={{ color: 'var(--color-text-tertiary)', fontSize: 'var(--text-xs)', marginBottom: 4 }}>strong</p>
      <Divider strength="strong" spacing="sm" />
    </div>
  ),
};
