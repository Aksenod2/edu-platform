'use client';

import { useMemo } from 'react';
import { LessonItem } from '@/components/schedule/lesson-item';
import {
  dateKey,
  groupByDay,
  lessonKey,
  type ScheduleLesson,
} from '@/components/schedule/utils';

/** Список занятий на сегодня по всем/выбранному потоку. */
export function TodayView({
  lessons,
  onMarkDone,
}: {
  lessons: ScheduleLesson[];
  onMarkDone?: (lesson: ScheduleLesson) => void | Promise<void>;
}) {
  const todayLessons = useMemo(() => {
    const key = dateKey(new Date());
    return groupByDay(lessons).get(key) ?? [];
  }, [lessons]);

  const todayLabel = new Date().toLocaleDateString('ru-RU', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm font-medium capitalize text-muted-foreground">
        {todayLabel}
      </p>
      {todayLessons.length === 0 ? (
        <div className="rounded-lg border border-dashed bg-card p-8 text-center text-sm text-muted-foreground">
          На сегодня занятий нет.
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {todayLessons.map((lesson) => (
            <LessonItem key={lessonKey(lesson)} lesson={lesson} onMarkDone={onMarkDone} />
          ))}
        </div>
      )}
    </div>
  );
}
