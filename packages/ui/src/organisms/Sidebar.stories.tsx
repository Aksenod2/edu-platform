/**
 * Sidebar — Организм
 * Atomic Design: Organism
 *
 * 240px фиксированная навигация. Секции с uppercase лейблами.
 * Active NavItem: красная левая полоска.
 */
import type { Meta, StoryObj } from '@storybook/react';
import { Sidebar } from './Sidebar';

const meta: Meta<typeof Sidebar> = {
  title: 'Organisms/Sidebar',
  component: Sidebar,
  tags: ['autodocs'],
  parameters: { layout: 'fullscreen' },
  decorators: [(Story) => <div style={{ height: 500 }}><Story /></div>],
};

export default meta;
type Story = StoryObj<typeof Sidebar>;

export const AdminSidebar: Story = {
  args: {
    currentPath: '/admin',
    sections: [
      {
        label: 'УПРАВЛЕНИЕ',
        items: [
          { label: 'Обзор', href: '/admin', icon: '⊞' },
          { label: 'Ученики', href: '/admin/students', icon: '◉' },
          { label: 'Потоки', href: '/admin/streams', icon: '≡' },
          { label: 'Расписание', href: '/admin/schedule', icon: '▦' },
        ],
      },
    ],
  },
};

export const StudentSidebar: Story = {
  args: {
    currentPath: '/dashboard',
    sections: [
      {
        label: 'ОБУЧЕНИЕ',
        items: [
          { label: 'Обзор', href: '/dashboard', icon: '⊞' },
          { label: 'Уроки', href: '/dashboard/lessons', icon: '▤' },
          { label: 'Задания', href: '/dashboard/assignments', icon: '☑' },
          { label: 'Тред', href: '/dashboard/thread', icon: '◫' },
          { label: 'Расписание', href: '/dashboard/schedule', icon: '▦' },
          { label: 'Профиль', href: '/dashboard/profile', icon: '◇' },
        ],
      },
    ],
  },
};
