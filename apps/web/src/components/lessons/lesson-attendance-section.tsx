'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Info,
  LogIn,
  Minus,
  Presentation,
  RefreshCw,
  Unlink,
  UserPlus,
  Users,
  Video,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Separator } from '@/components/ui/separator';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@platform/ui/lib/utils';
import {
  getLessonAttendance,
  getStreamStudents,
  markLessonAttendance,
  matchLessonAttendance,
  resyncLessonAttendance,
  type SessionAttendanceRecord,
  type SessionAttendanceSummary,
  type Student,
} from '@/lib/api';

// Относительное время последнего zoom-забора («обновлено N мин. назад»),
// в духе notification-bell. Старое (>7 дней) — абсолютная дата.
function formatSyncedAt(iso: string): string {
  const date = new Date(iso);
  const diffMin = Math.round((Date.now() - date.getTime()) / 60000);
  if (diffMin < 1) return 'обновлено только что';
  if (diffMin < 60) return `обновлено ${diffMin} мин. назад`;
  const diffH = Math.round(diffMin / 60);
  if (diffH < 24) return `обновлено ${diffH} ч. назад`;
  const diffD = Math.round(diffH / 24);
  if (diffD < 7) return `обновлено ${diffD} дн. назад`;
  return `обновлено ${date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })}`;
}

// Длительность из секунд в человеко-читаемое «45 мин» / «1 ч 5 мин».
function formatDuration(sec: number | null): string | null {
  if (!sec || sec <= 0) return null;
  const totalMin = Math.round(sec / 60);
  if (totalMin < 60) return `${totalMin} мин`;
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return m > 0 ? `${h} ч ${m} мин` : `${h} ч`;
}

// Время входа в созвон («18:30»).
function formatJoinTime(iso: string | null): string | null {
  if (!iso) return null;
  return new Date(iso).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
}

// Плитка-счётчик сводки (одинаковый стиль с lesson-analytics-section).
function StatTile({
  value,
  label,
  tone = 'default',
}: {
  value: number;
  label: string;
  tone?: 'default' | 'positive' | 'attention' | 'muted';
}) {
  return (
    <div className="flex flex-col gap-1 rounded-lg border bg-card p-4">
      <span
        className={cn(
          'text-3xl font-bold tabular-nums leading-none',
          tone === 'positive' && 'text-primary',
          tone === 'attention' && 'text-destructive',
          tone === 'muted' && 'text-muted-foreground',
        )}
      >
        {value}
      </span>
      <span className="text-sm text-muted-foreground">{label}</span>
    </div>
  );
}

// Сегментированный переключатель «Был / Не был» с явным тап-таргетом ≥44px.
// status === null — отметки ещё нет (нейтральный вид, ничего не подсвечено).
function StatusToggle({
  status,
  disabled,
  onChange,
}: {
  status: 'present' | 'absent' | null;
  disabled?: boolean;
  onChange: (next: 'present' | 'absent') => void;
}) {
  return (
    <div className="flex shrink-0 overflow-hidden rounded-md border" role="group">
      <button
        type="button"
        disabled={disabled}
        aria-pressed={status === 'present'}
        onClick={() => onChange('present')}
        className={cn(
          'flex min-h-11 items-center justify-center px-3 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60',
          status === 'present'
            ? 'bg-primary text-primary-foreground'
            : 'bg-card text-muted-foreground hover:bg-accent',
        )}
      >
        Был
      </button>
      <span className="w-px bg-border" aria-hidden />
      <button
        type="button"
        disabled={disabled}
        aria-pressed={status === 'absent'}
        onClick={() => onChange('absent')}
        className={cn(
          'flex min-h-11 items-center justify-center px-3 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60',
          status === 'absent'
            ? 'bg-destructive text-white'
            : 'bg-card text-muted-foreground hover:bg-accent',
        )}
      >
        Не был
      </button>
    </div>
  );
}

// Read-only бейдж статуса для авто-режима (посещаемость берётся из Zoom).
// «Был» — primary с галочкой, «Не был» — приглушённый outline.
function StatusBadge({ present }: { present: boolean }) {
  return present ? (
    <Badge className="shrink-0">
      <Check className="size-3" />
      Был
    </Badge>
  ) : (
    <Badge variant="outline" className="shrink-0 text-muted-foreground">
      <Minus className="size-3" />
      Не был
    </Badge>
  );
}

/**
 * Блок «Посещаемость» во View Mode урока: сводка занятия (Session = lessonId ×
 * streamId) + статус посещаемости по составу группы + привязка несопоставленных
 * zoom-гостей. По образцу LessonAnalyticsSection (стиль/состояния).
 *
 * Режим определяется по данным: если в сводке есть хоть одна zoom-запись —
 * посещаемость считается автоматически из Zoom и показывается read-only
 * (бейдж «Был/Не был»). Если zoom-данных по занятию нет вовсе (оффлайн) —
 * показываем прежний ручной переключатель как фолбэк.
 *
 * «Обновить из Zoom» (resync) может вернуть мягкий отказ (ok:false) —
 * показываем причину ненавязчиво, без алярма.
 */
export function LessonAttendanceSection({
  accessToken,
  lessonId,
  streamId,
}: {
  accessToken: string;
  lessonId: string;
  streamId: string;
}) {
  const [summary, setSummary] = useState<SessionAttendanceSummary | null>(null);
  const [students, setStudents] = useState<Student[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  // 404 = занятия (Session) по этому потоку нет → «нет данных», блок-заглушка.
  const [noSession, setNoSession] = useState(false);

  const [syncing, setSyncing] = useState(false);
  // Мягкий отказ resync (нет scope у Zoom / отчёт не готов / нет встречи).
  const [resyncNotice, setResyncNotice] = useState('');
  // userId студента, по которому идёт ручная отметка (для точечной блокировки).
  const [pendingUserId, setPendingUserId] = useState<string | null>(null);
  // attendanceId гостя, которого сейчас привязываем.
  const [matchingId, setMatchingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    setNoSession(false);
    try {
      const [att, { students: list }] = await Promise.all([
        getLessonAttendance(accessToken, lessonId, streamId),
        getStreamStudents(accessToken, streamId),
      ]);
      setSummary(att);
      setStudents(list);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Ошибка загрузки посещаемости';
      if (msg.includes('не найден')) {
        setNoSession(true);
      } else {
        setError(msg);
      }
    } finally {
      setLoading(false);
    }
  }, [accessToken, lessonId, streamId]);

  useEffect(() => {
    load();
  }, [load]);

  // Перезабрать посещаемость из Zoom. Не бросает: ok:false → мягкая подсказка.
  async function handleResync() {
    if (syncing) return;
    setSyncing(true);
    setResyncNotice('');
    try {
      const res = await resyncLessonAttendance(accessToken, lessonId, streamId);
      if (res.ok) {
        setSummary(res);
        toast.success(`Из Zoom загружено: участников — ${res.presentCount}`);
      } else {
        // Не ошибка — частая причина: scope ещё не выдан в Zoom. Показываем спокойно.
        setResyncNotice(res.reason || 'Данные Zoom пока недоступны.');
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Не удалось обновить из Zoom');
    } finally {
      setSyncing(false);
    }
  }

  // Ручная отметка студента. Обновляем сводку ответом сервера.
  async function handleMark(userId: string, status: 'present' | 'absent') {
    if (pendingUserId) return;
    setPendingUserId(userId);
    try {
      const next = await markLessonAttendance(accessToken, lessonId, {
        streamId,
        userId,
        status,
      });
      setSummary(next);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Не удалось сохранить отметку');
    } finally {
      setPendingUserId(null);
    }
  }

  // Привязать zoom-гостя к студенту потока.
  async function handleMatch(attendanceId: string, userId: string) {
    if (matchingId) return;
    setMatchingId(attendanceId);
    try {
      const next = await matchLessonAttendance(accessToken, lessonId, attendanceId, {
        streamId,
        userId,
      });
      setSummary(next);
      toast.success('Гость привязан к студенту');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Не удалось привязать гостя');
    } finally {
      setMatchingId(null);
    }
  }

  // Сбросить привязку zoom-гостя (userId → null): запись снова станет
  // несопоставленным гостем и её можно привязать заново. Переназначение =
  // сбросить → привязать к другому студенту.
  async function handleUnmatch(attendanceId: string) {
    if (matchingId) return;
    setMatchingId(attendanceId);
    try {
      const next = await matchLessonAttendance(accessToken, lessonId, attendanceId, {
        streamId,
      });
      setSummary(next);
      toast.success('Привязка сброшена');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Не удалось сбросить привязку');
    } finally {
      setMatchingId(null);
    }
  }

  // Карта userId → актуальная запись посещаемости (для статуса и zoom-данных).
  // Приоритет ручной записи над zoom (бэк так же считает сводку).
  const recordByUserId = useMemo(() => {
    const map = new Map<string, SessionAttendanceRecord>();
    for (const r of summary?.records ?? []) {
      if (!r.userId) continue;
      const prev = map.get(r.userId);
      // manual важнее zoom_report; если оба manual/zoom — берём первый встретившийся.
      if (!prev || (prev.source !== 'manual' && r.source === 'manual')) {
        map.set(r.userId, r);
      }
    }
    return map;
  }, [summary]);

  // Zoom-данные по студенту (даже если ручной статус перекрыл) — «был в Zoom».
  const zoomByUserId = useMemo(() => {
    const map = new Map<string, SessionAttendanceRecord>();
    for (const r of summary?.records ?? []) {
      if (r.userId && r.source === 'zoom_report') map.set(r.userId, r);
    }
    return map;
  }, [summary]);

  // Несопоставленные гости: zoom-записи без привязки к студенту, кроме хоста
  // (хост — это аккаунт преподавателя, его показываем отдельной секцией).
  const guests = useMemo(
    () => (summary?.records ?? []).filter((r) => !r.userId && !r.isHost),
    [summary],
  );

  // Хост встречи (преподаватель) — показываем отдельно, без привязки к студенту.
  const hosts = useMemo(
    () => (summary?.records ?? []).filter((r) => r.isHost),
    [summary],
  );

  // Режим определяется наличием zoom-данных по занятию: есть хоть одна запись
  // source==='zoom_report' → АВТО (read-only из Zoom); нет ни одной → РУЧНОЙ
  // (фолбэк для оффлайн-занятий, прежний переключатель «Был/Не был»).
  const hasZoomData = useMemo(
    () => (summary?.records ?? []).some((r) => r.source === 'zoom_report'),
    [summary],
  );

  const isEmpty =
    !!summary &&
    summary.records.length === 0 &&
    summary.lastSyncedAt === null;

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2">
            <Users className="size-5 shrink-0 text-muted-foreground" />
            Посещаемость
          </CardTitle>
          {/* Resync — только когда занятие есть и блок загружен без ошибки. */}
          {!loading && !error && !noSession && (
            <Button
              size="sm"
              variant="outline"
              onClick={handleResync}
              disabled={syncing}
            >
              <RefreshCw className={cn('size-4', syncing && 'animate-spin')} />
              Обновить из Zoom
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex flex-col gap-4">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-[88px] rounded-lg" />
              ))}
            </div>
            <div className="flex flex-col gap-2">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-12 rounded-md" />
              ))}
            </div>
          </div>
        ) : error ? (
          <div className="flex flex-col items-start gap-3 rounded-md border bg-muted p-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="flex items-start gap-2 text-sm text-muted-foreground">
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" />
              <span>{error}</span>
            </p>
            <Button size="sm" variant="outline" onClick={load} className="w-full sm:w-auto">
              <RefreshCw className="size-4" />
              Повторить
            </Button>
          </div>
        ) : noSession || !summary ? (
          <p className="text-sm text-muted-foreground">
            Посещаемость появится, когда урок будет запланирован занятием в этой группе.
          </p>
        ) : (
          <div className="flex flex-col gap-5">
            {/* Сводка-счётчики. */}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <StatTile value={summary.presentCount} label="Присутствовали" tone="positive" />
              <StatTile value={summary.absentCount} label="Отсутствовали" tone="muted" />
              <StatTile value={summary.enrolledCount} label="Всего в группе" />
              <StatTile
                value={summary.unmatchedCount}
                label="Гостей"
                tone={summary.unmatchedCount > 0 ? 'attention' : 'default'}
              />
            </div>

            {/* Время последнего забора из Zoom. */}
            {summary.lastSyncedAt && (
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <RefreshCw className="size-3.5" />
                Zoom: {formatSyncedAt(summary.lastSyncedAt)}
              </p>
            )}

            {/* Мягкий отказ resync (например, scope ещё не выдан) — без алярма. */}
            {resyncNotice && (
              <div className="flex flex-col gap-1 rounded-md border bg-muted p-3">
                <p className="flex items-start gap-2 text-sm text-muted-foreground">
                  <Info className="mt-0.5 size-4 shrink-0" />
                  <span>{resyncNotice}</span>
                </p>
                {/* Подсказка про ручную отметку уместна только в фолбэк-режиме. */}
                {!hasZoomData && (
                  <p className="pl-6 text-xs text-muted-foreground">
                    Ручная отметка ниже работает всегда — отметьте посещаемость вручную.
                  </p>
                )}
              </div>
            )}

            {/* Пусто: ни записей, ни синка — предлагаем обновить или отметить вручную. */}
            {isEmpty && !resyncNotice && (
              <p className="text-sm text-muted-foreground">
                Данных пока нет. Нажмите «Обновить из Zoom» или отметьте посещаемость вручную в
                списке ниже.
              </p>
            )}

            {/* Посещаемость по составу группы. */}
            <div className="flex flex-col gap-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-medium text-muted-foreground">Состав группы</span>
                {/* Подсказка, откуда берётся статус в текущем режиме. */}
                {students.length > 0 &&
                  (hasZoomData ? (
                    <span className="flex items-center gap-1 text-xs text-muted-foreground">
                      <Video className="size-3" />
                      статус из Zoom
                    </span>
                  ) : (
                    <span className="text-xs text-muted-foreground">отметьте вручную</span>
                  ))}
              </div>
              {students.length === 0 ? (
                <p className="text-sm text-muted-foreground">В группе пока нет студентов.</p>
              ) : (
                <ul className="flex flex-col divide-y rounded-md border">
                  {students.map((student) => {
                    const record = recordByUserId.get(student.id);
                    const zoom = zoomByUserId.get(student.id);
                    const status = record?.status ?? null;
                    const duration = zoom ? formatDuration(zoom.durationSec) : null;
                    const joinTime = zoom ? formatJoinTime(zoom.joinedAt) : null;
                    // В авто-режиме «был» = есть сопоставленная present zoom-запись.
                    const presentInZoom = zoom?.status === 'present';
                    return (
                      <li
                        key={student.id}
                        className="flex flex-wrap items-center justify-between gap-3 p-3"
                      >
                        <div className="flex min-w-0 flex-col gap-0.5">
                          <Link
                            href={`/admin/students/${student.id}`}
                            className="truncate text-sm font-medium transition-colors hover:text-primary"
                          >
                            {student.name}
                          </Link>
                          {zoom && (
                            <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
                              <span className="flex items-center gap-1">
                                <Video className="size-3" />
                                был в Zoom
                              </span>
                              {duration && <span>· {duration}</span>}
                              {joinTime && (
                                <span className="flex items-center gap-1">
                                  · <LogIn className="size-3" />
                                  вход {joinTime}
                                </span>
                              )}
                            </span>
                          )}
                        </div>
                        {hasZoomData ? (
                          // АВТО: статус определён Zoom, read-only. Если студент
                          // сопоставлен с zoom-гостём — даём сбросить привязку
                          // (например, привязали не к тому студенту). Сброс →
                          // гость снова в списке несопоставленных, можно привязать
                          // заново к нужному студенту.
                          <div className="flex shrink-0 items-center gap-2">
                            <StatusBadge present={presentInZoom} />
                            {zoom && (
                              <Button
                                size="sm"
                                variant="ghost"
                                className="text-muted-foreground"
                                disabled={matchingId === zoom.id}
                                onClick={() => handleUnmatch(zoom.id)}
                                title="Отвязать zoom-гостя от этого студента"
                              >
                                <Unlink className="size-4" />
                                Сбросить привязку
                              </Button>
                            )}
                          </div>
                        ) : (
                          // РУЧНОЙ фолбэк: нет данных Zoom — отмечаем вручную.
                          <StatusToggle
                            status={status}
                            disabled={pendingUserId === student.id}
                            onChange={(next) => handleMark(student.id, next)}
                          />
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            {/* Преподаватель (хост Zoom-встречи) — отдельной секцией, без привязки. */}
            {hosts.length > 0 && (
              <>
                <Separator />
                <div className="flex flex-col gap-2">
                  <span className="text-xs font-medium text-muted-foreground">Преподаватель</span>
                  <ul className="flex flex-col divide-y rounded-md border">
                    {hosts.map((host) => {
                      const duration = formatDuration(host.durationSec);
                      const joinTime = formatJoinTime(host.joinedAt);
                      const name = host.displayName || host.email || 'Преподаватель';
                      return (
                        <li
                          key={host.id}
                          className="flex flex-wrap items-center justify-between gap-3 p-3"
                        >
                          <div className="flex min-w-0 flex-col gap-0.5">
                            <span className="truncate text-sm font-medium">{name}</span>
                            <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
                              {host.email && host.displayName && (
                                <span className="truncate">{host.email}</span>
                              )}
                              {duration && <span>· {duration}</span>}
                              {joinTime && <span>· вход {joinTime}</span>}
                            </span>
                          </div>
                          <Badge variant="outline" className="shrink-0 text-muted-foreground">
                            <Presentation className="size-3" />
                            преподаватель
                          </Badge>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              </>
            )}

            {/* Несопоставленные гости из Zoom. */}
            {guests.length > 0 && (
              <>
                <Separator />
                <div className="flex flex-col gap-2">
                  <span className="text-xs font-medium text-muted-foreground">
                    Гости из Zoom (не сопоставлены)
                  </span>
                  <ul className="flex flex-col divide-y rounded-md border">
                    {guests.map((guest) => {
                      const duration = formatDuration(guest.durationSec);
                      const joinTime = formatJoinTime(guest.joinedAt);
                      return (
                        <li
                          key={guest.id}
                          className="flex flex-wrap items-center justify-between gap-3 p-3"
                        >
                          <div className="flex min-w-0 flex-col gap-0.5">
                            <span className="truncate text-sm font-medium">
                              {guest.displayName || guest.email || 'Гость'}
                            </span>
                            <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
                              {guest.email && guest.displayName && (
                                <span className="truncate">{guest.email}</span>
                              )}
                              {duration && <span>· {duration}</span>}
                              {joinTime && <span>· вход {joinTime}</span>}
                            </span>
                          </div>
                          {/* Привязка к студенту потока. */}
                          <div className="flex shrink-0 items-center gap-2">
                            <UserPlus className="size-4 shrink-0 text-muted-foreground" />
                            <Select
                              disabled={matchingId === guest.id || students.length === 0}
                              onValueChange={(userId) => handleMatch(guest.id, userId)}
                            >
                              <SelectTrigger size="sm" className="min-w-44">
                                <SelectValue placeholder="Привязать к студенту" />
                              </SelectTrigger>
                              <SelectContent>
                                {students.map((s) => (
                                  <SelectItem key={s.id} value={s.id}>
                                    {s.name}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              </>
            )}

            {/* Спокойный позитивный итог: вся группа отмечена, отсутствующих нет. */}
            {!isEmpty &&
              summary.enrolledCount > 0 &&
              summary.presentCount === summary.enrolledCount && (
                <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
                  <CheckCircle2 className="size-4 text-primary" />
                  Присутствовала вся группа.
                </p>
              )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
