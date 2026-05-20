/**
 * NavItem — Молекула
 * Atomic Design: Molecule
 *
 * Элемент навигации sidebar.
 * Active state: красная левая граница (--color-accent-red).
 */
import type { Meta, StoryObj } from '@storybook/react';
import { NavItem } from './NavItem';

const meta: Meta<typeof NavItem> = {
  title: 'Molecules/NavItem',
  component: NavItem,
  tags: ['autodocs'],
  argTypes: {
    active: { control: 'boolean' },
    label: { control: 'text' },
  },
};

export default meta;
type Story = StoryObj<typeof NavItem>;

export const Default: Story = {
  args: { label: 'Обзор', href: '#', icon: '⊞' },
};

export const Active: Story = {
  args: { label: 'Потоки', href: '#', icon: '≡', active: true },
};

export const NavigationList: Story = {
  render: () => (
    <div style={{ width: 240, background: 'var(--color-bg-surface)', padding: '16px 0' }}>
      <NavItem label="Обзор" href="#" icon="⊞" active />
      <NavItem label="Ученики" href="#" icon="◉" />
      <NavItem label="Потоки" href="#" icon="≡" />
      <NavItem label="Расписание" href="#" icon="▦" />
    </div>
  ),
};
