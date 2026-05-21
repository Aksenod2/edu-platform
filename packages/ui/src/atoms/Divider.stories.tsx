/**
 * Divider — Атом (shadcn Separator)
 * Atomic Design: Atom
 *
 * Строгий 1px разделитель. Nothing Phone: ноль декора, только линия.
 * Варианты: horizontal / vertical, три силы цвета, три отступа.
 */
import type { Meta, StoryObj } from '@storybook/react';
import { Divider } from './Divider';

const ContextBlock = ({ children }: { children: React.ReactNode }) => (
  <div style={{ padding: '16px', width: 320, background: 'var(--color-bg-base)' }}>
    {children}
  </div>
);

const SectionLabel = ({ children }: { children: React.ReactNode }) => (
  <p style={{ color: 'var(--color-text-secondary)', fontSize: 'var(--text-sm)', margin: 0 }}>
    {children}
  </p>
);

const SpacingLabel = ({ children }: { children: React.ReactNode }) => (
  <p style={{ color: 'var(--color-text-tertiary)', fontSize: 'var(--text-xs)', margin: '8px 0 0' }}>
    {children}
  </p>
);

import React from 'react';

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
    <ContextBlock>
      <SectionLabel>Раздел А</SectionLabel>
      <Divider {...args} />
      <SectionLabel>Раздел Б</SectionLabel>
    </ContextBlock>
  ),
  args: { orientation: 'horizontal', strength: 'default', spacing: 'md' },
};

export const Vertical: Story = {
  render: (args) => (
    <div style={{ display: 'flex', alignItems: 'center', height: 48, padding: '0 16px', background: 'var(--color-bg-base)' }}>
      <span style={{ color: 'var(--color-text-secondary)', fontSize: 'var(--text-sm)' }}>Слева</span>
      <Divider {...args} />
      <span style={{ color: 'var(--color-text-secondary)', fontSize: 'var(--text-sm)' }}>Справа</span>
    </div>
  ),
  args: { orientation: 'vertical', strength: 'default', spacing: 'sm' },
};

export const Subtle: Story = {
  render: (args) => (
    <ContextBlock>
      <SectionLabel>Содержимое выше</SectionLabel>
      <Divider {...args} />
      <SectionLabel>Содержимое ниже</SectionLabel>
    </ContextBlock>
  ),
  args: { orientation: 'horizontal', strength: 'subtle', spacing: 'md' },
};

export const Strong: Story = {
  render: (args) => (
    <ContextBlock>
      <SectionLabel>Содержимое выше</SectionLabel>
      <Divider {...args} />
      <SectionLabel>Содержимое ниже</SectionLabel>
    </ContextBlock>
  ),
  args: { orientation: 'horizontal', strength: 'strong', spacing: 'md' },
};

export const AllStrengths: Story = {
  render: () => (
    <ContextBlock>
      <SpacingLabel>subtle — #1A1A1A (bg-base) / #1A1A1A (bg-surface #0D0D0D)</SpacingLabel>
      <Divider strength="subtle" spacing="sm" />
      <SpacingLabel>default — #2A2A2A</SpacingLabel>
      <Divider strength="default" spacing="sm" />
      <SpacingLabel>strong — #404040</SpacingLabel>
      <Divider strength="strong" spacing="sm" />
    </ContextBlock>
  ),
};

export const AllSpacings: Story = {
  render: () => (
    <ContextBlock>
      <SpacingLabel>sm — var(--spacing-3) ≈ 12px</SpacingLabel>
      <SectionLabel>Раздел А</SectionLabel>
      <Divider strength="default" spacing="sm" />
      <SectionLabel>Раздел Б</SectionLabel>
      <SpacingLabel>md — var(--spacing-6) ≈ 24px</SpacingLabel>
      <SectionLabel>Раздел А</SectionLabel>
      <Divider strength="default" spacing="md" />
      <SectionLabel>Раздел Б</SectionLabel>
      <SpacingLabel>lg — var(--spacing-8) ≈ 32px</SpacingLabel>
      <SectionLabel>Раздел А</SectionLabel>
      <Divider strength="default" spacing="lg" />
      <SectionLabel>Раздел Б</SectionLabel>
    </ContextBlock>
  ),
};
