/**
 * Spinner — Атом
 * Atomic Design: Atom
 *
 * Индикатор загрузки. np-spin keyframe.
 */
import type { Meta, StoryObj } from '@storybook/react';
import { Spinner } from './Spinner';

const meta: Meta<typeof Spinner> = {
  title: 'Atoms/Spinner',
  component: Spinner,
  tags: ['autodocs'],
};

export default meta;
type Story = StoryObj<typeof Spinner>;

export const Default: Story = {};

export const Small: Story = {
  args: { size: 'sm' },
};
