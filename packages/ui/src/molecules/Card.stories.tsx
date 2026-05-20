/**
 * Card — Молекула
 * Atomic Design: Molecule
 *
 * Nothing Phone: строгий прямоугольный контейнер без теней, 1px граница.
 * Варианты: default (surface bg), elevated (darker), outlined (transparent).
 */
import type { Meta, StoryObj } from '@storybook/react';
import { Card, CardHeader, CardBody, CardFooter } from './Card';
import { Heading, Text, Mono } from '../atoms/Typography';
import { Button } from '../atoms/Button';
import { Badge } from '../atoms/Badge';

const meta: Meta<typeof Card> = {
  title: 'Molecules/Card',
  component: Card,
  tags: ['autodocs'],
  argTypes: {
    variant: { control: 'select', options: ['default', 'elevated', 'outlined'] },
    padding: { control: 'select', options: ['none', 'sm', 'md', 'lg'] },
    interactive: { control: 'boolean' },
  },
};

export default meta;
type Story = StoryObj<typeof Card>;

export const Default: Story = {
  args: {
    children: (
      <>
        <Mono size="xs">STUDENTS</Mono>
        <Heading level={3} style={{ marginTop: 8 }}>Ученики</Heading>
        <Text size="sm" color="tertiary">Список и карточки учеников</Text>
      </>
    ),
  },
};

export const Elevated: Story = {
  args: {
    variant: 'elevated',
    children: (
      <>
        <Mono size="xs">STREAMS</Mono>
        <Heading level={3} style={{ marginTop: 8 }}>Потоки</Heading>
        <Text size="sm" color="tertiary">Учебные группы и их уроки</Text>
      </>
    ),
  },
};

export const Outlined: Story = {
  args: {
    variant: 'outlined',
    children: (
      <>
        <Mono size="xs">SCHEDULE</Mono>
        <Heading level={3} style={{ marginTop: 8 }}>Расписание</Heading>
        <Text size="sm" color="tertiary">Предстоящие занятия и сроки сдачи</Text>
      </>
    ),
  },
};

export const WithHeaderAndFooter: Story = {
  render: () => (
    <Card style={{ width: 360 }}>
      <CardHeader action={<Badge variant="success">Активный</Badge>}>
        <Heading level={4}>Основы UX/UI Design 2026</Heading>
      </CardHeader>
      <CardBody>
        <Text size="sm" color="secondary">Учебная группа по основам дизайна интерфейсов.</Text>
      </CardBody>
      <CardFooter>
        <Button size="sm" variant="secondary">Уроки</Button>
        <Button size="sm" variant="secondary">Задания</Button>
      </CardFooter>
    </Card>
  ),
};

export const Interactive: Story = {
  args: {
    interactive: true,
    children: (
      <>
        <Mono size="xs">ASSIGNMENTS</Mono>
        <Heading level={3} style={{ marginTop: 8 }}>Задания</Heading>
        <Text size="sm" color="tertiary">Управление заданиями (через потоки)</Text>
      </>
    ),
  },
};

export const DashboardGrid: Story = {
  render: () => (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16, width: 800 }}>
      {['STUDENTS', 'STREAMS', 'SCHEDULE', 'ASSIGNMENTS'].map((label) => (
        <Card key={label} variant="outlined" interactive>
          <Mono size="xs">{label}</Mono>
          <Heading level={3} style={{ marginTop: 8 }}>
            {label === 'STUDENTS' ? 'Ученики' :
             label === 'STREAMS' ? 'Потоки' :
             label === 'SCHEDULE' ? 'Расписание' : 'Задания'}
          </Heading>
          <Text size="sm" color="tertiary">Описание секции</Text>
        </Card>
      ))}
    </div>
  ),
};
