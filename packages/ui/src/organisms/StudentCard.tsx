/**
 * StudentCard — Организм
 * Atomic level: Organism
 *
 * Состав: Card (молекула) + Avatar (атом) + Heading/Text/Mono (атомы) + Badge (атом)
 * Токены: spacing, color tokens
 *
 * Назначение: карточка ученика в списке/дашборде преподавателя
 * Контекст: платформа — проводник данных, не мессенджер.
 *   Карточка = информационная сущность, не точка общения.
 *
 * Nothing Phone: данные, не дизайн. Иерархия через размер и цвет.
 * Дизайн-линзы: Proximity (группировка данных), Kano (must-have = имя + статус)
 */
import React from 'react';
import { cn } from '../lib/utils';
import { Card } from '../molecules/Card';
import { Avatar } from '../atoms/Avatar';
import { Badge } from '../atoms/Badge';
import { Heading, Text, Mono } from '../atoms/Typography';

export type StudentStatus = 'active' | 'inactive' | 'pending';

export interface StudentCardStudent {
  id: string;
  name: string;
  email?: string;
  avatarSrc?: string;
  stream?: string;
  status: StudentStatus;
  lastActivity?: string;
  completedTasks?: number;
  totalTasks?: number;
}

export interface StudentCardProps {
  student: StudentCardStudent;
  onClick?: (student: StudentCardStudent) => void;
  compact?: boolean;
}

const statusBadge: Record<StudentStatus, { variant: 'success' | 'error' | 'warning'; label: string }> = {
  active:   { variant: 'success', label: 'ACTIVE' },
  inactive: { variant: 'error',   label: 'INACTIVE' },
  pending:  { variant: 'warning', label: 'PENDING' },
};

export function StudentCard({ student, onClick, compact = false }: StudentCardProps) {
  const { variant: badgeVariant, label: badgeLabel } = statusBadge[student.status];
  const hasProgress = student.completedTasks !== undefined && student.totalTasks !== undefined;

  return (
    <Card
      interactive={Boolean(onClick)}
      padding={compact ? 'sm' : 'md'}
      onClick={onClick ? () => onClick(student) : undefined}
    >
      {/* Верхняя строка: аватар + имя + статус */}
      <div className="flex items-start gap-3">
        <Avatar
          name={student.name}
          src={student.avatarSrc}
          size={compact ? 'sm' : 'md'}
        />

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <Heading
              level={4}
              size="md"
              className="flex-1 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap"
            >
              {student.name}
            </Heading>
            <Badge variant={badgeVariant}>{badgeLabel}</Badge>
          </div>

          {student.email && !compact && (
            <Mono size="xs" className="text-text-tertiary mt-1">
              {student.email}
            </Mono>
          )}

          {student.stream && (
            <Text size="xs" color="tertiary" className={cn(!compact && 'mt-1')}>
              {student.stream}
            </Text>
          )}
        </div>
      </div>

      {/* Прогресс + последняя активность */}
      {!compact && (hasProgress || student.lastActivity) && (
        <div className="mt-4 pt-4 border-t border-border-subtle flex items-center justify-between gap-4">
          {hasProgress && (
            <div className="flex flex-col gap-1">
              <Mono size="xs" className="text-text-tertiary">TASKS</Mono>
              <div className="flex items-baseline gap-1">
                <Mono size="base" className="text-accent-neon font-bold">
                  {student.completedTasks}
                </Mono>
                <Mono size="xs" className="text-text-tertiary">
                  / {student.totalTasks}
                </Mono>
              </div>
              <ProgressBar value={student.completedTasks!} max={student.totalTasks!} />
            </div>
          )}

          {student.lastActivity && (
            <div className="text-right">
              <Mono size="xs" className="text-text-tertiary">LAST SEEN</Mono>
              <Mono size="xs" className="text-text-secondary mt-1 block">
                {student.lastActivity}
              </Mono>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

function ProgressBar({ value, max }: { value: number; max: number }) {
  const percent = max > 0 ? Math.min((value / max) * 100, 100) : 0;
  return (
    <div className="w-20 h-0.5 bg-border-default rounded-none overflow-hidden">
      <div
        className="h-full bg-accent-neon transition-[width] duration-[var(--duration-slow)] ease-[var(--ease-out)]"
        style={{ width: `${percent}%` }}
      />
    </div>
  );
}
