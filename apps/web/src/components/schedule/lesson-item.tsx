'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Check, Loader2 } from 'lucide-react';
import { cn } from '@platform/ui/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { RecordingStatusBadge } from '@/components/schedule/recording-status-badge';
import { LessonStatusBadge } from '@/components/schedule/lesson-status-badge';
import {
  canJoinMeeting,
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
  lessonBasePath = '/admin/lessons',
}: {
  lesson: ScheduleLesson;
  compact?: boolean;
  onMarkDone?: (lesson: ScheduleLesson) => void | Promise<void>;
  /** Базовый путь страницы урока — зависит от роли (студент vs админ). */
  lessonBasePath?: string;
}) {
  const cancelled = lesson.status === 'cancelled';
  const [marking, setMarking] = useState(false);
  const router = useRouter();

  const canMarkDone = !!onMarkDone && lesson.status === 'planned';

  // Путь на страницу урока. Для админа добавляем ?streamId — чтобы View Mode урока
  // открылся в контексте конкретного занятия (статус/запись/итоги/статистика по
  // потоку). Для студента ('/dashboard/lessons') контекст потока не нужен — не трогаем.
  const href =
    lessonBasePath === '/admin/lessons' && lesson.streamId
      ? `${lessonBasePath}/${lesson.id}?streamId=${lesson.streamId}`
      : `${lessonBasePath}/${lesson.id}`;

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
      role="button"
      tabIndex={0}
      onClick={() => router.push(href)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          router.push(href);
        }
      }}
      className={cn(
        'flex cursor-pointer flex-col gap-1.5 rounded-lg border bg-card p-3 transition-colors hover:bg-accent/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        cancelled && 'opacity-60',
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <p
          className={cn(
            'min-w-0 break-words font-medium leading-tight',
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
        <LessonStatusBadge status={lesson.status} />
        {lesson.streamName && (
          <Badge variant="secondary" className="w-fit max-w-full truncate">
            {lesson.streamName}
          </Badge>
        )}
        {/* Статус записи Zoom — только для прошедших занятий. У «готово» бейдж
            скрываем (showReady=false): видео и так открывается в плеере урока. */}
        {lesson.status === 'done' && (
          <RecordingStatusBadge
            status={lesson.recordingStatus}
            error={lesson.recordingError}
            requestedAt={lesson.recordingRequestedAt}
            showReady={false}
            className="w-fit"
          />
        )}
      </div>

      {(canJoinMeeting(lesson) || canMarkDone) && (
        <div className="mt-1 flex flex-wrap items-center gap-2">
          {canJoinMeeting(lesson) && (
            <a
              href={lesson.meetingUrl ?? undefined}
              target="_blank"
              rel="noopener noreferrer"
              className="no-underline"
              onClick={(e) => e.stopPropagation()}
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
              onClick={(e) => {
                e.stopPropagation();
                handleMarkDone();
              }}
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
