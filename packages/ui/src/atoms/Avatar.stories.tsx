/**
 * Avatar — Атом
 * Atomic Design: Atom
 *
 * Nothing Phone: строгий квадрат (не круг), Space Mono инициалы.
 * Размеры: xs (24), sm (32), md (40), lg (56), xl (80).
 */
import type { Meta, StoryObj } from '@storybook/react';
import { Avatar } from './Avatar';

const meta: Meta<typeof Avatar> = {
  title: 'Atoms/Avatar',
  component: Avatar,
  tags: ['autodocs'],
  argTypes: {
    size: { control: 'select', options: ['xs', 'sm', 'md', 'lg', 'xl'] },
    name: { control: 'text' },
    online: { control: 'boolean' },
  },
};

export default meta;
type Story = StoryObj<typeof Avatar>;

export const Initials: Story = {
  args: { name: 'Мария Ученик', size: 'md' },
};

export const SingleName: Story = {
  args: { name: 'Администратор', size: 'md' },
};

export const Online: Story = {
  args: { name: 'Мария Ученик', size: 'lg', online: true },
};

export const Offline: Story = {
  args: { name: 'Мария Ученик', size: 'lg', online: false },
};

export const AllSizes: Story = {
  render: () => (
    <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
      <Avatar name="МУ" size="xs" />
      <Avatar name="МУ" size="sm" />
      <Avatar name="МУ" size="md" />
      <Avatar name="МУ" size="lg" />
      <Avatar name="МУ" size="xl" />
    </div>
  ),
};
