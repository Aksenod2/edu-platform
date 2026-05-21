/**
 * NavItem — Молекула
 * Atomic Design: Molecule
 *
 * Элемент навигации sidebar.
 * Active state: красная левая граница (accent-red).
 * Tailwind v4, CMP-251.
 */
import type { Meta, StoryObj } from '@storybook/react';
import { NavItem } from './NavItem';

const meta: Meta<typeof NavItem> = {
  title: 'Molecules/NavItem',
  component: NavItem,
  tags: ['autodocs'],
  argTypes: {
    active:   { control: 'boolean' },
    disabled: { control: 'boolean' },
    label:    { control: 'text' },
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

export const Disabled: Story = {
  args: { label: 'Настройки', href: '#', icon: '⚙', disabled: true },
};

export const WithBadge: Story = {
  name: 'С бейджем',
  args: {
    label: 'Уведомления',
    href: '#',
    icon: '◎',
    badge: (
      <span style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 18,
        height: 18,
        borderRadius: '50%',
        background: '#FF0000',
        color: '#000',
        fontSize: '0.6rem',
        fontWeight: 700,
        fontFamily: 'Space Mono, monospace',
      }}>
        3
      </span>
    ),
  },
};

export const NavigationList: Story = {
  name: 'Список навигации',
  render: () => (
    <div style={{ width: 240, background: '#0D0D0D', padding: '16px 0' }}>
      <NavItem label="Обзор"      href="#" icon="⊞" active />
      <NavItem label="Ученики"    href="#" icon="◉" />
      <NavItem label="Потоки"     href="#" icon="≡" />
      <NavItem label="Расписание" href="#" icon="▦" />
    </div>
  ),
};

export const AsButton: Story = {
  name: 'Без href (button)',
  args: {
    label: 'Выйти',
    icon: '←',
    onClick: () => alert('Выход'),
  },
};
