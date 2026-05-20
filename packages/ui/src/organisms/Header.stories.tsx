/**
 * Header — Организм
 * Atomic Design: Organism
 *
 * 56px sticky header. Dot-matrix лого + PLATFORM (Space Mono) + пользователь.
 * Nothing Phone: строгий border-bottom, нет теней.
 */
import type { Meta, StoryObj } from '@storybook/react';
import { Header } from './Header';

const meta: Meta<typeof Header> = {
  title: 'Organisms/Header',
  component: Header,
  tags: ['autodocs'],
  parameters: { layout: 'fullscreen' },
};

export default meta;
type Story = StoryObj<typeof Header>;

export const Admin: Story = {
  args: {
    platformName: 'PLATFORM ADMIN',
    user: { name: 'Администратор', role: 'admin' },
    onLogout: () => {},
  },
};

export const Student: Story = {
  args: {
    platformName: 'PLATFORM',
    user: { name: 'Мария Ученик', role: 'student' },
    onLogout: () => {},
  },
};

export const NoUser: Story = {
  args: { platformName: 'PLATFORM' },
};
