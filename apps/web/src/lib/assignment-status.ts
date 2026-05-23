import type { StudentAssignmentStatus } from '@/lib/api';

export type { StudentAssignmentStatus };

type BadgeVariant = 'default' | 'secondary' | 'outline' | 'destructive';

// Единый канон подписей и вариантов статусов задания (StudentAssignment) —
// один источник правды для студенческих и админских экранов.
export const STATUS_LABELS: Record<StudentAssignmentStatus, string> = {
  assigned: 'Назначено',
  submitted: 'На проверке',
  reviewed: 'Принято',
  needs_revision: 'На доработке',
};

export const STATUS_VARIANT: Record<StudentAssignmentStatus, BadgeVariant> = {
  assigned: 'secondary',
  submitted: 'outline',
  reviewed: 'default',
  needs_revision: 'secondary',
};

export const STATUS_ORDER: StudentAssignmentStatus[] = [
  'assigned',
  'submitted',
  'reviewed',
  'needs_revision',
];

// Безопасный доступ к подписи/варианту: на случай неизвестного статуса с бэка
// показываем сам код и нейтральный outline вместо падения.
export function getStatusMeta(status: string): { label: string; variant: BadgeVariant } {
  const known = status as StudentAssignmentStatus;
  if (known in STATUS_LABELS) {
    return { label: STATUS_LABELS[known], variant: STATUS_VARIANT[known] };
  }
  return { label: status, variant: 'outline' };
}
