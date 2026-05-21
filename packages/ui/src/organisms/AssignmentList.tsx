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
import { cn } from '../lib/utils';
import { Card } from '../molecules/Card';
import { Badge } from '../atoms/Badge';
import { Heading, Mono } from '../atoms/Typography';
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
    <div className="flex flex-col gap-2" role="list">
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
      className={isOverdue ? 'border-l-2 border-l-[var(--color-error)]' : undefined}
    >
      <div className="flex items-start gap-4">
        {/* Контент */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <Heading
              level={4}
              size="sm"
              className="overflow-hidden text-ellipsis whitespace-nowrap max-w-[400px]"
            >
              {assignment.title}
            </Heading>
            {assignment.hasNewFeedback && (
              <span
                className="inline-block w-1.5 h-1.5 rounded-full bg-accent-red shrink-0"
                title="Новая обратная связь"
                aria-label="Новая обратная связь"
              />
            )}
          </div>

          <div className="flex items-center gap-4 flex-wrap">
            {assignment.lessonTitle && (
              <Mono size="xs" className="text-text-tertiary">
                {assignment.lessonTitle}
              </Mono>
            )}
            {assignment.dueDate && (
              <Mono
                size="xs"
                className={cn(isOverdue ? 'text-error' : 'text-text-tertiary')}
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
