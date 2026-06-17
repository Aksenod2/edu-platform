'use client';

// Общие примитивы видимости материалов/видео урока по потокам.
// streamId = null/undefined → «Общий» метод (виден всем потокам урока);
// заданный streamId → только студентам этого потока. Используется и в секции
// материалов, и в менеджере видео, чтобы не дублировать селектор/бейдж/резолв.

import { useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { getLessonSessions, type LessonSession } from '@/lib/api';

// shadcn Select не принимает пустое значение у SelectItem — для «Общий метод»
// держим sentinel, наружу отдаём undefined.
export const COMMON_VALUE = '__common__';

// Загружает сессии (потоки) урока один раз. При ошибке/отсутствии — пустой список
// (селектор покажет только «Общий», без падений).
export function useLessonStreams(accessToken: string, lessonId: string): LessonSession[] {
  const [sessions, setSessions] = useState<LessonSession[]>([]);

  useEffect(() => {
    let cancelled = false;
    getLessonSessions(accessToken, lessonId)
      .then(({ sessions }) => {
        if (!cancelled) setSessions(sessions);
      })
      .catch(() => {
        if (!cancelled) setSessions([]);
      });
    return () => {
      cancelled = true;
    };
  }, [accessToken, lessonId]);

  return sessions;
}

// Резолвит название потока по streamId. Для null/неизвестного — null (значит «Общий»).
export function resolveStreamName(
  streamId: string | null | undefined,
  sessions: LessonSession[],
): string | null {
  if (!streamId) return null;
  return sessions.find((s) => s.streamId === streamId)?.streamName ?? null;
}

// Бейдж видимости рядом с материалом/видео.
export function VisibilityBadge({
  streamId,
  sessions,
}: {
  streamId: string | null | undefined;
  sessions: LessonSession[];
}) {
  const name = resolveStreamName(streamId, sessions);
  if (!name) {
    return (
      <Badge variant="secondary" className="shrink-0 font-normal">
        Общий
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="shrink-0 font-normal" title={`Поток: ${name}`}>
      <span className="max-w-32 truncate">Поток: {name}</span>
    </Badge>
  );
}

// Селектор видимости при загрузке/смене: «Общий (метод)» + потоки урока.
// value/onChange работают в терминах streamId (undefined = общий).
export function VisibilitySelect({
  value,
  onChange,
  sessions,
  disabled,
  id,
  className,
}: {
  value: string | undefined;
  onChange: (streamId: string | undefined) => void;
  sessions: LessonSession[];
  disabled?: boolean;
  id?: string;
  className?: string;
}) {
  return (
    <Select
      value={value ?? COMMON_VALUE}
      onValueChange={(v) => onChange(v === COMMON_VALUE ? undefined : v)}
      disabled={disabled}
    >
      <SelectTrigger id={id} className={className ?? 'w-full sm:w-56'}>
        <SelectValue placeholder="Видимость" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={COMMON_VALUE}>Общий (метод)</SelectItem>
        {sessions.map((s) => (
          <SelectItem key={s.streamId} value={s.streamId}>
            Поток: {s.streamName}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
