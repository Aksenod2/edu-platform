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
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--space-3)' }}>
        <Avatar
          name={student.name}
          src={student.avatarSrc}
          size={compact ? 'sm' : 'md'}
        />

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
            <Heading level={4} size="md" style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {student.name}
            </Heading>
            <Badge variant={badgeVariant}>{badgeLabel}</Badge>
          </div>

          {student.email && !compact && (
            <Mono size="xs" style={{ color: 'var(--color-text-tertiary)', marginTop: 'var(--space-1)' }}>
              {student.email}
            </Mono>
          )}

          {student.stream && (
            <Text size="xs" color="tertiary" style={{ marginTop: compact ? 0 : 'var(--space-1)' }}>
              {student.stream}
            </Text>
          )}
        </div>
      </div>

      {/* Прогресс + последняя активность */}
      {!compact && (hasProgress || student.lastActivity) && (
        <div
          style={{
            marginTop: 'var(--space-4)',
            paddingTop: 'var(--space-4)',
            borderTop: '1px solid var(--color-border-subtle)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 'var(--space-4)',
          }}
        >
          {hasProgress && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
              <Mono size="xs" style={{ color: 'var(--color-text-tertiary)' }}>TASKS</Mono>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--space-1)' }}>
                <Mono size="base" style={{ color: 'var(--color-accent-neon)', fontWeight: 700 }}>
                  {student.completedTasks}
                </Mono>
                <Mono size="xs" style={{ color: 'var(--color-text-tertiary)' }}>
                  / {student.totalTasks}
                </Mono>
              </div>
              <ProgressBar value={student.completedTasks!} max={student.totalTasks!} />
            </div>
          )}

          {student.lastActivity && (
            <div style={{ textAlign: 'right' }}>
              <Mono size="xs" style={{ color: 'var(--color-text-tertiary)' }}>LAST SEEN</Mono>
              <Mono size="xs" style={{ color: 'var(--color-text-secondary)', marginTop: 'var(--space-1)', display: 'block' }}>
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
    <div
      style={{
        width: 80,
        height: 2,
        background: 'var(--color-border-default)',
        borderRadius: 0,
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          width: `${percent}%`,
          height: '100%',
          background: 'var(--color-accent-neon)',
          transition: 'width var(--duration-slow) var(--ease-out)',
        }}
      />
    </div>
  );
}
