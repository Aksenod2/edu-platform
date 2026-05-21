/**
 * EmptyState — Молекула
 * Atomic Design: Molecule
 *
 * Плейсхолдер для пустого контента.
 * Tailwind v4, CMP-251.
 */
import type { Meta, StoryObj } from '@storybook/react';
import { EmptyState } from './EmptyState';

const meta: Meta<typeof EmptyState> = {
  title: 'Molecules/EmptyState',
  component: EmptyState,
  tags: ['autodocs'],
  argTypes: {
    size: { control: 'select', options: ['sm', 'md', 'lg'] },
  },
};

export default meta;
type Story = StoryObj<typeof EmptyState>;

export const Default: Story = {
  args: {
    title: 'Нет потоков',
    description: 'Создайте первый учебный поток для начала работы.',
    action: { label: 'Создать поток', onClick: () => {} },
  },
};

export const NoAction: Story = {
  args: {
    title: 'Нет заданий',
    description: 'Здесь будут отображаться назначенные вам задания.',
  },
};

export const DotMatrix: Story = {
  name: 'Dot-matrix placeholder (без иконки)',
  args: {
    title: 'Нет данных',
    description: 'Dot-matrix заглушка — Nothing Phone aesthetic.',
  },
};

export const WithIcon: Story = {
  name: 'С иконкой',
  args: {
    icon: (
      <svg width="100%" height="100%" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
        <circle cx="12" cy="12" r="10" />
        <path d="M12 8v4M12 16h.01" />
      </svg>
    ),
    title: 'Нет уведомлений',
    description: 'Когда появятся уведомления, они отобразятся здесь.',
  },
};

export const Small: Story = {
  args: {
    title: 'Список пуст',
    description: 'Добавьте первый элемент.',
    size: 'sm',
  },
};

export const Large: Story = {
  args: {
    title: 'Добро пожаловать',
    description: 'Начните работу, создав первый проект на платформе.',
    action: { label: 'Начать', onClick: () => {} },
    size: 'lg',
  },
};
