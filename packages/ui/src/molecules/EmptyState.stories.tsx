/**
 * EmptyState — Молекула
 * Atomic Design: Molecule
 *
 * Плейсхолдер для пустого контента.
 */
import type { Meta, StoryObj } from '@storybook/react';
import { EmptyState } from './EmptyState';

const meta: Meta<typeof EmptyState> = {
  title: 'Molecules/EmptyState',
  component: EmptyState,
  tags: ['autodocs'],
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
