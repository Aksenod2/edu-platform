'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  CheckCircle2,
  ClipboardCheck,
  Download,
  Eye,
  FileUp,
  Loader2,
  PlayCircle,
  RotateCw,
  UserCheck,
  UserX,
  type LucideIcon,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { getStudentActivity, type ActivityEvent } from '@/lib/api';

const PAGE_SIZE = 50;

// Время события: «12:34» (день выводится отдельным заголовком группы).
function formatTime(value: string): string {
  return new Date(value).toLocaleTimeString('ru-RU', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

// Заголовок группы дня: «Сегодня» / «Вчера» / «2 июня 2026».
function formatDayHeading(value: string): string {
  const date = new Date(value);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);

  const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();

  if (sameDay(date, today)) return 'Сегодня';
  if (sameDay(date, yesterday)) return 'Вчера';
  return date.toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

// Ключ дня (YYYY-MM-DD по локальному времени) для группировки.
function dayKey(value: string): string {
  const d = new Date(value);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

type EventView = {
  icon: LucideIcon;
  // Тон иконки: спокойные семантические токены под тип события.
  iconClass: string;
  title: string;
  subtitle?: string;
  badge?: { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' };
};

// Человекочитаемое представление события по контракту агрегатора.
function describeEvent(event: ActivityEvent): EventView {
  const lesson = event.lessonTitle ?? 'без названия';

  switch (event.type) {
    case 'attendance': {
      const absent = event.status === 'absent';
      return {
        icon: absent ? UserX : UserCheck,
        iconClass: absent ? 'text-destructive' : 'text-primary',
        title: absent
          ? `Отсутствовал на уроке «${lesson}»`
          : `Был на уроке «${lesson}»`,
        subtitle: event.streamName ? `Поток ${event.streamName}` : undefined,
      };
    }
    case 'assignment_submitted':
      return {
        icon: FileUp,
        iconClass: 'text-foreground',
        title: `Сдал домашнюю работу по уроку «${lesson}»`,
        subtitle: event.streamName ? `Поток ${event.streamName}` : undefined,
      };
    case 'assignment_reviewed':
      return {
        icon: ClipboardCheck,
        iconClass: 'text-primary',
        title: `Домашняя работа проверена по уроку «${lesson}»`,
        subtitle: event.streamName ? `Поток ${event.streamName}` : undefined,
      };
    case 'video_watched': {
      const completed = event.completed === true;
      const percent =
        typeof event.watchedPercent === 'number' ? `${event.watchedPercent}%` : undefined;
      // Подпись — урок/поток (что есть).
      const parts = [
        event.lessonTitle ? `Урок «${event.lessonTitle}»` : null,
        event.streamName ? `Поток ${event.streamName}` : null,
      ].filter(Boolean) as string[];
      return {
        icon: PlayCircle,
        iconClass: 'text-foreground',
        title: `Посмотрел видео «${event.videoTitle ?? 'без названия'}»`,
        subtitle: parts.length ? parts.join(' · ') : undefined,
        badge: completed
          ? { label: 'досмотрел', variant: 'default' }
          : percent
            ? { label: percent, variant: 'secondary' }
            : undefined,
      };
    }
    case 'material_viewed':
    case 'material_downloaded': {
      // Подпись — урок/поток (как у video_watched).
      const parts = [
        event.lessonTitle ? `Урок «${event.lessonTitle}»` : null,
        event.streamName ? `Поток ${event.streamName}` : null,
      ].filter(Boolean) as string[];
      const name = event.materialName ?? 'без названия';
      const viewed = event.type === 'material_viewed';
      return {
        icon: viewed ? Eye : Download,
        iconClass: 'text-foreground',
        title: viewed
          ? `Посмотрел материал «${name}»`
          : `Скачал материал «${name}»`,
        subtitle: parts.length ? parts.join(' · ') : undefined,
      };
    }
    default:
      return {
        icon: CheckCircle2,
        iconClass: 'text-muted-foreground',
        title: 'Событие',
      };
  }
}

export function StudentActivityTab({
  accessToken,
  studentId,
}: {
  accessToken: string;
  studentId: string;
}) {
  const [items, setItems] = useState<ActivityEvent[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');

  const loadFirst = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await getStudentActivity(accessToken, studentId, { limit: PAGE_SIZE });
      setItems(res.items);
      setNextCursor(res.nextCursor);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось загрузить активность');
    } finally {
      setLoading(false);
    }
  }, [accessToken, studentId]);

  useEffect(() => {
    loadFirst();
  }, [loadFirst]);

  const loadMore = async () => {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const res = await getStudentActivity(accessToken, studentId, {
        limit: PAGE_SIZE,
        before: nextCursor,
      });
      // Накапливаем в общий список (страницы идут по убыванию timestamp).
      setItems((prev) => [...prev, ...res.items]);
      setNextCursor(res.nextCursor);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось загрузить ещё');
    } finally {
      setLoadingMore(false);
    }
  };

  // ── Загрузка (первая страница) ──
  if (loading) {
    return (
      <Card>
        <CardContent className="space-y-5">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex items-start gap-3">
              <Skeleton className="size-9 shrink-0 rounded-full" />
              <div className="flex-1 space-y-2 pt-0.5">
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-3 w-1/3" />
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    );
  }

  // ── Ошибка первой загрузки ──
  if (error && items.length === 0) {
    return (
      <Alert variant="destructive">
        <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
          <span>{error}</span>
          <Button variant="outline" size="lg" onClick={loadFirst}>
            <RotateCw className="size-4" aria-hidden="true" />
            Повторить
          </Button>
        </AlertDescription>
      </Alert>
    );
  }

  // ── Пусто ──
  if (items.length === 0) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
          <div className="flex size-12 items-center justify-center rounded-full bg-muted">
            <CheckCircle2 className="size-6 text-muted-foreground" aria-hidden="true" />
          </div>
          <p className="text-sm text-muted-foreground">Пока нет активности</p>
        </CardContent>
      </Card>
    );
  }

  // Группировка по дням: список идёт по убыванию времени, поэтому соседние
  // события одного дня уже лежат подряд — собираем группы линейным проходом.
  const groups: { key: string; date: string; events: ActivityEvent[] }[] = [];
  for (const event of items) {
    const key = dayKey(event.timestamp);
    const last = groups[groups.length - 1];
    if (last && last.key === key) {
      last.events.push(event);
    } else {
      groups.push({ key, date: event.timestamp, events: [event] });
    }
  }

  return (
    <div className="space-y-6">
      {groups.map((group) => (
        <section key={group.key} className="space-y-3">
          <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            {formatDayHeading(group.date)}
          </h3>
          <Card>
            <CardContent className="divide-y p-0">
              {group.events.map((event) => (
                <ActivityRow key={event.id} event={event} />
              ))}
            </CardContent>
          </Card>
        </section>
      ))}

      {/* Догрузка следующей страницы по курсору. */}
      {nextCursor && (
        <div className="flex justify-center">
          <Button variant="outline" size="lg" onClick={loadMore} disabled={loadingMore}>
            {loadingMore && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
            Показать ещё
          </Button>
        </div>
      )}

      {/* Ошибка догрузки (первая страница уже показана) — не ломаем ленту. */}
      {error && items.length > 0 && (
        <Alert variant="destructive">
          <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
            <span>{error}</span>
            <Button variant="outline" size="lg" onClick={loadMore} disabled={loadingMore}>
              <RotateCw className="size-4" aria-hidden="true" />
              Повторить
            </Button>
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}

function ActivityRow({ event }: { event: ActivityEvent }) {
  const view = describeEvent(event);
  const Icon = view.icon;

  return (
    <div className="flex items-start gap-3 px-4 py-3">
      <div className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-full border bg-muted/40">
        <Icon className={`size-4 ${view.iconClass}`} aria-hidden="true" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-sm text-foreground">{view.title}</span>
          {view.badge && (
            <Badge variant={view.badge.variant} className="shrink-0">
              {view.badge.label}
            </Badge>
          )}
        </div>
        {view.subtitle && (
          <p className="mt-0.5 truncate text-xs text-muted-foreground">{view.subtitle}</p>
        )}
      </div>
      <time className="mt-0.5 shrink-0 text-xs tabular-nums text-muted-foreground">
        {formatTime(event.timestamp)}
      </time>
    </div>
  );
}
