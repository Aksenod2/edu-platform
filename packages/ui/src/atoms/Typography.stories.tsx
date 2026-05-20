/**
 * Typography — Атом
 * Atomic Design: Atom
 *
 * Heading: Space Grotesk, tight leading, строгая иерархия.
 * Text: Space Grotesk, relaxed.
 * Mono: Space Mono — dot-matrix эффект для акцентов, кодов, меток.
 */
import type { Meta, StoryObj } from '@storybook/react';
import { Heading, Text, Mono } from './Typography';

const headingMeta: Meta<typeof Heading> = {
  title: 'Atoms/Typography/Heading',
  component: Heading,
  tags: ['autodocs'],
  argTypes: {
    level: { control: 'select', options: [1, 2, 3, 4] },
    size: { control: 'select', options: ['xs', 'sm', 'md', 'lg', 'xl', '2xl', '3xl', '4xl'] },
    weight: { control: 'select', options: ['light', 'regular', 'medium', 'semibold', 'bold'] },
  },
};

export default headingMeta;

type HeadingStory = StoryObj<typeof Heading>;

export const H1: HeadingStory = {
  args: { level: 1, children: 'Панель управления' },
};

export const H2: HeadingStory = {
  args: { level: 2, children: 'Потоки' },
};

export const H3: HeadingStory = {
  args: { level: 3, children: 'Уроки: Основы UX/UI Design 2026' },
};

export const H4: HeadingStory = {
  args: { level: 4, children: 'Секция контента' },
};

export const HeadingScale: HeadingStory = {
  render: () => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <Heading level={1}>H1 — Панель управления</Heading>
      <Heading level={2}>H2 — Потоки</Heading>
      <Heading level={3}>H3 — Уроки</Heading>
      <Heading level={4}>H4 — Секция</Heading>
    </div>
  ),
};

export const TextDefault: HeadingStory = {
  render: () => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <Text size="lg" color="primary">Text Large / Primary</Text>
      <Text size="base" color="secondary">Text Base / Secondary — описание страницы</Text>
      <Text size="sm" color="tertiary">Text Small / Tertiary — подсказка</Text>
      <Text size="xs" color="disabled">Text XS / Disabled</Text>
    </div>
  ),
};

export const MonoAccent: HeadingStory = {
  render: () => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <Mono size="base">PLATFORM ADMIN</Mono>
      <Mono size="sm">STUDENTS · STREAMS · SCHEDULE</Mono>
      <Mono size="xs" color="var(--color-accent-red)">20.05.2026</Mono>
    </div>
  ),
};
