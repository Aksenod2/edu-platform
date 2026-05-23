'use client';

import { cn } from '@platform/ui/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  LESSON_STATUS_LABELS,
  STATUS_BADGE_VARIANT,
  type ScheduleLesson,
} from '@/components/schedule/utils';

/**
 * Карточка одного занятия для списочных видов («Сегодня» / «Неделя»):
 * время, название, бейджи статуса и потока, кнопка «Присоединиться».
 */
export function LessonItem({
  lesson,
  compact = false,
}: {
  lesson: ScheduleLesson;
  compact?: boolean;
}) {
  const cancelled = lesson.status === 'cancelled';

  return (
    <div
      className={cn(
        'flex flex-col gap-1.5 rounded-lg border bg-card p-3',
        cancelled && 'opacity-60',
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <p
          className={cn(
            'font-medium leading-tight',
            compact && 'text-sm',
            cancelled && 'line-through',
          )}
        >
          {lesson.title}
        </p>
        {lesson.startTime && (
          <span className="shrink-0 font-mono text-sm text-muted-foreground">
            {lesson.startTime}
          </span>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <Badge variant={STATUS_BADGE_VARIANT[lesson.status]} className="w-fit">
          {LESSON_STATUS_LABELS[lesson.status]}
        </Badge>
        {lesson.streamName && (
          <Badge variant="secondary" className="w-fit max-w-full truncate">
            {lesson.streamName}
          </Badge>
        )}
      </div>

      {lesson.meetingUrl && !cancelled && (
        <a
          href={lesson.meetingUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-1 inline-block no-underline"
        >
          <Button size="sm" variant="secondary">
            Присоединиться
          </Button>
        </a>
      )}
    </div>
  );
}
