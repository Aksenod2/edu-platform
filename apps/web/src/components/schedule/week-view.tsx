'use client';

import { useMemo, useState, type CSSProperties } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@platform/ui/lib/utils';
import { Button } from '@/components/ui/button';
import { LessonItem } from '@/components/schedule/lesson-item';
import {
  WEEKDAYS_SHORT,
  addDays,
  dateKey,
  groupByDay,
  isSameDay,
  lessonKey,
  startOfWeek,
  type ScheduleLesson,
} from '@/components/schedule/utils';

/** Недельный вид: 7 колонок (Пн–Вс) с занятиями и навигацией по неделям. */
export function WeekView({
  lessons,
  onMarkDone,
  lessonBasePath = '/admin/lessons',
}: {
  lessons: ScheduleLesson[];
  onMarkDone?: (lesson: ScheduleLesson) => void | Promise<void>;
  /** Базовый путь страницы урока — пробрасывается в карточки занятий. */
  lessonBasePath?: string;
}) {
  const today = new Date();
  const [weekStart, setWeekStart] = useState(() => startOfWeek(today));

  const days = useMemo(
    () => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)),
    [weekStart],
  );

  const lessonsByDay = useMemo(() => groupByDay(lessons), [lessons]);

  // Адаптивная ширина колонок (десктоп): дни с занятиями шире, пустые — примерно
  // вдвое уже. Доли задаём во fr, чтобы сумма колонок всегда занимала всю ширину.
  // Если занятий нет ни в одном дне — все колонки равны (1fr).
  const columnTemplate = useMemo(() => {
    return days
      .map((day) =>
        (lessonsByDay.get(dateKey(day))?.length ?? 0) > 0
          ? 'minmax(0, 2fr)'
          : 'minmax(3.5rem, 1fr)',
      )
      .join(' ');
  }, [days, lessonsByDay]);

  const weekEnd = addDays(weekStart, 6);
  const rangeLabel = `${weekStart.toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'short',
  })} — ${weekEnd.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })}`;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-lg font-semibold tracking-tight">{rangeLabel}</h2>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setWeekStart(startOfWeek(new Date()))}
          >
            Сегодня
          </Button>
          <Button
            variant="outline"
            size="icon"
            onClick={() => setWeekStart((w) => addDays(w, -7))}
            aria-label="Предыдущая неделя"
          >
            <ChevronLeft />
          </Button>
          <Button
            variant="outline"
            size="icon"
            onClick={() => setWeekStart((w) => addDays(w, 7))}
            aria-label="Следующая неделя"
          >
            <ChevronRight />
          </Button>
        </div>
      </div>

      {/* На мобилке — стопка (grid-cols-1). На десктопе (sm:) колонки распределяются
          по долям из --week-cols: дни с занятиями шире, пустые уже. CSS-переменная
          задаётся inline, но применяется к grid только на sm:, поэтому мобильная
          стопка не ломается. min-width у колонок держит читаемость заголовков. */}
      <div
        className="grid grid-cols-1 gap-3 sm:gap-2 sm:[grid-template-columns:var(--week-cols)]"
        style={{ '--week-cols': columnTemplate } as CSSProperties}
      >
        {days.map((day, i) => {
          const dayLessons = lessonsByDay.get(dateKey(day)) ?? [];
          const isToday = isSameDay(day, today);
          return (
            <div
              key={dateKey(day)}
              className={cn(
                'flex min-h-[120px] min-w-0 flex-col gap-2 rounded-lg border bg-card p-2',
                isToday && 'border-primary',
              )}
            >
              <div className="flex items-baseline justify-between gap-1 border-b pb-1.5">
                <span className="truncate text-xs font-medium text-muted-foreground">
                  {WEEKDAYS_SHORT[i]}
                </span>
                <span
                  className={cn(
                    'inline-flex h-6 min-w-6 items-center justify-center rounded-full px-1 text-xs',
                    isToday && 'bg-primary font-semibold text-primary-foreground',
                  )}
                >
                  {day.getDate()}
                </span>
              </div>
              <div className="flex flex-col gap-2">
                {dayLessons.length === 0 ? (
                  <span className="px-1 text-[11px] text-muted-foreground/60">—</span>
                ) : (
                  dayLessons.map((lesson) => (
                    <LessonItem
                      key={lessonKey(lesson)}
                      lesson={lesson}
                      compact
                      onMarkDone={onMarkDone}
                      lessonBasePath={lessonBasePath}
                    />
                  ))
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
