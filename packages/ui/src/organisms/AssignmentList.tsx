/**
 * AssignmentList — Организм
 * Atomic level: Organism
 *
 * Состав: список Card (молекула) + Badge (атом) + EmptyState (молекула)
 * Токены: spacing, semantic colors
 *
 * Назначение: список заданий для ученика или список в дашборде преподавателя
 * Контекст: платформа — проводник данных.
 *   Задание = структурированная единица: статус, срок, тип.
 *
 * Дизайн-линзы:
 *   - Serial Position Effect: важные задания вверху
 *   - Von Restorff: просроченные выделяются красным
 *   - Miller's Law: группировка по статусу, не >7 на экран
 */
import React from 'react';
import { Card } from '../molecules/Card';
import { Badge } from '../atoms/Badge';
import { Heading, Text, Mono } from '../atoms/Typography';
import { EmptyState } from '../molecules/EmptyState';

export type AssignmentStatus = 'pending' | 'submitted' | 'reviewed' | 'overdue' | 'needs_revision';

export interface Assignment {
  id: string;
  title: string;
  description?: string;
  status: AssignmentStatus;
  dueDate?: string;
  submittedAt?: string;
  lessonTitle?: string;
  hasNewFeedback?: boolean;
}

export interface AssignmentListProps {
  assignments: Assignment[];
  onAssignmentClick?: (assignment: Assignment) => void;
  emptyTitle?: string;
  emptyDescription?: string;
}

const statusConfig: Record<AssignmentStatus, {
  label: string;
  variant: 'default' | 'success' | 'warning' | 'error' | 'info';
}> = {
  pending:         { label: 'TO DO',           variant: 'default' },
  submitted:       { label: 'SUBMITTED',       variant: 'info' },
  reviewed:        { label: 'REVIEWED',        variant: 'success' },
  overdue:         { label: 'OVERDUE',         variant: 'error' },
  needs_revision:  { label: 'НА ДОРАБОТКЕ',   variant: 'warning' },
};

export function AssignmentList({
  assignments,
  onAssignmentClick,
  emptyTitle = 'Нет заданий',
  emptyDescription = 'Здесь появятся задания от преподавателя',
}: AssignmentListProps) {
  if (assignments.length === 0) {
    return (
      <EmptyState
        title={emptyTitle}
        description={emptyDescription}
        size="md"
      />
    );
  }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--space-2)',
      }}
      role="list"
    >
      {assignments.map((assignment) => (
        <AssignmentRow
          key={assignment.id}
          assignment={assignment}
          onClick={onAssignmentClick}
        />
      ))}
    </div>
  );
}

function AssignmentRow({
  assignment,
  onClick,
}: {
  assignment: Assignment;
  onClick?: (a: Assignment) => void;
}) {
  const { label, variant } = statusConfig[assignment.status];
  const isOverdue = assignment.status === 'overdue';

  return (
    <Card
      as="li"
      interactive={Boolean(onClick)}
      padding="md"
      onClick={onClick ? () => onClick(assignment) : undefined}
      style={{
        ...(isOverdue && {
          borderColor: 'var(--color-error)',
          borderLeftWidth: 2,
        }),
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--space-4)' }}>
        {/* Контент */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flexWrap: 'wrap', marginBottom: 'var(--space-1)' }}>
            <Heading level={4} size="sm" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 400 }}>
              {assignment.title}
            </Heading>
            {assignment.hasNewFeedback && (
              <span
                style={{
                  display: 'inline-block',
                  width: 6,
                  height: 6,
                  borderRadius: '50%',
                  background: 'var(--color-accent-red)',
                  flexShrink: 0,
                }}
                title="Новая обратная связь"
                aria-label="Новая обратная связь"
              />
            )}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-4)', flexWrap: 'wrap' }}>
            {assignment.lessonTitle && (
              <Mono size="xs" style={{ color: 'var(--color-text-tertiary)' }}>
                {assignment.lessonTitle}
              </Mono>
            )}
            {assignment.dueDate && (
              <Mono
                size="xs"
                style={{
                  color: isOverdue ? 'var(--color-error)' : 'var(--color-text-tertiary)',
                }}
              >
                DUE {assignment.dueDate}
              </Mono>
            )}
          </div>
        </div>

        {/* Статус */}
        <Badge variant={variant}>{label}</Badge>
      </div>
    </Card>
  );
}
