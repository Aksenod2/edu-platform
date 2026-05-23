'use client';

import { useState } from 'react';
import { Check, Loader2 } from 'lucide-react';
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
  onMarkDone,
}: {
  lesson: ScheduleLesson;
  compact?: boolean;
  onMarkDone?: (lesson: ScheduleLesson) => void | Promise<void>;
}) {
  const cancelled = lesson.status === 'cancelled';
  const [marking, setMarking] = useState(false);

  const canMarkDone = !!onMarkDone && lesson.status === 'planned';

  const handleMarkDone = async () => {
    if (!onMarkDone) return;
    setMarking(true);
    try {
      await onMarkDone(lesson);
    } finally {
      setMarking(false);
    }
  };

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

      {((lesson.meetingUrl && !cancelled) || canMarkDone) && (
        <div className="mt-1 flex flex-wrap items-center gap-2">
          {lesson.meetingUrl && !cancelled && (
            <a
              href={lesson.meetingUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="no-underline"
            >
              <Button size="sm" variant="secondary">
                Присоединиться
              </Button>
            </a>
          )}
          {canMarkDone && (
            <Button
              size="sm"
              variant="outline"
              onClick={handleMarkDone}
              disabled={marking}
            >
              {marking ? <Loader2 className="animate-spin" /> : <Check />}
              Провести
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
