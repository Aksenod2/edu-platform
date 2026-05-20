/**
 * Button — Атом
 * Atomic Design: Atom
 *
 * Основная кнопка дизайн-системы Nothing Phone.
 * Primary = красный акцент (#FF0000), secondary = bordered, ghost = прозрачный, danger = ошибка.
 * Все кнопки — uppercase, Space Grotesk, tracking-wide.
 */
import type { Meta, StoryObj } from '@storybook/react';
import { Button } from './Button';

const meta: Meta<typeof Button> = {
  title: 'Atoms/Button',
  component: Button,
  tags: ['autodocs'],
  argTypes: {
    variant: {
      control: 'select',
      options: ['primary', 'secondary', 'ghost', 'danger'],
      description: 'Визуальный вариант кнопки',
    },
    size: {
      control: 'select',
      options: ['sm', 'md', 'lg'],
      description: 'Размер: sm (28px), md (36px), lg (44px)',
    },
    loading: { control: 'boolean' },
    disabled: { control: 'boolean' },
    fullWidth: { control: 'boolean' },
  },
};

export default meta;
type Story = StoryObj<typeof Button>;

export const Primary: Story = {
  args: { variant: 'primary', children: 'Создать' },
};

export const Secondary: Story = {
  args: { variant: 'secondary', children: 'Отмена' },
};

export const Ghost: Story = {
  args: { variant: 'ghost', children: 'Подробнее' },
};

export const Danger: Story = {
  args: { variant: 'danger', children: 'Удалить' },
};

export const Loading: Story = {
  args: { variant: 'primary', loading: true, children: 'Сохранение' },
};

export const Disabled: Story = {
  args: { variant: 'primary', disabled: true, children: 'Недоступно' },
};

export const Small: Story = {
  args: { variant: 'secondary', size: 'sm', children: 'Уроки' },
};

export const Large: Story = {
  args: { variant: 'primary', size: 'lg', children: 'Добавить занятие' },
};

export const FullWidth: Story = {
  args: { variant: 'primary', fullWidth: true, children: 'Войти' },
  decorators: [(Story) => <div style={{ width: 320 }}><Story /></div>],
};

export const AllVariants: Story = {
  render: () => (
    <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
      <Button variant="primary">Primary</Button>
      <Button variant="secondary">Secondary</Button>
      <Button variant="ghost">Ghost</Button>
      <Button variant="danger">Danger</Button>
    </div>
  ),
};

export const AllSizes: Story = {
  render: () => (
    <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
      <Button size="sm">Small</Button>
      <Button size="md">Medium</Button>
      <Button size="lg">Large</Button>
    </div>
  ),
};
