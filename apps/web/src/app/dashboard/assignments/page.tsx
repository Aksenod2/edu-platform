'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { Loader2, ChevronDown, ChevronLeft, X, FileText, ExternalLink, MessageCircle, ClipboardList } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  getStudentAssignments,
  submitStudentAssignment,
  getStreams,
  getThread,
  trackMaterialAccess,
  type StudentAssignment,
  type Stream,
  type ThreadEntry,
} from '@/lib/api';
import { STATUS_LABELS, STATUS_ORDER, type StudentAssignmentStatus } from '@/lib/assignment-status';
import { useBack } from '@/components/back-button';
import { FileLightbox } from '@/components/files/file-lightbox';
import Link from 'next/link';

const TYPE_LABELS: Record<string, string> = {
  short: 'Короткое',
  long: 'Длинное',
};

// Номер урока вытаскиваем из заголовка урока («Урок 01 — …» → 1). Числового поля
// порядка в API заданий нет, а нумерация в названии — ровно тот ориентир, по которому
// студент ищет урок. Нет совпадения (напр. индивидуальное задание без урока) → null.
function lessonNumber(title?: string | null): number | null {
  if (!title) return null;
  const m = title.match(/урок\s*0*(\d+)/i);
  return m ? parseInt(m[1], 10) : null;
}

// Цвет статуса (Уровень 2): Принято=зелёный, На проверке=синий, На доработке=янтарный,
// Назначено=нейтральный. Возвращаем className поверх Badge — tailwind-merge заменит фон
// варианта. Просрочка показывается отдельным красным бейджем (см. карточку).
function statusBadgeClass(status: StudentAssignmentStatus): string {
  switch (status) {
    case 'reviewed':
      return 'border-transparent bg-green-600/15 text-green-700 dark:text-green-400';
    case 'submitted':
      return 'border-transparent bg-blue-600/15 text-blue-700 dark:text-blue-400';
    case 'needs_revision':
      return 'border-transparent bg-amber-500/15 text-amber-700 dark:text-amber-500';
    case 'assigned':
    default:
      return 'border-transparent bg-muted text-muted-foreground';
  }
}

export default function StudentAssignmentsPage() {
  const { user, accessToken } = useAuth();
  const router = useRouter();
  const goBack = useBack('/dashboard');

  const [assignments, setAssignments] = useState<StudentAssignment[]>([]);
  const [streams, setStreams] = useState<Stream[]>([]);
  const [loadingData, setLoadingData] = useState(true);
  const [error, setError] = useState('');
  const [streamFilter, setStreamFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [assignmentFeedback, setAssignmentFeedback] = useState<Record<string, ThreadEntry | null>>({});
  const [submissionModalSaId, setSubmissionModalSaId] = useState<string | null>(null);
  const [submissionText, setSubmissionText] = useState('');
  const [submissionFile, setSubmissionFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const fetchData = useCallback(async () => {
    if (!accessToken) return;
    setLoadingData(true);
    try {
      const params: { streamId?: string; status?: string } = {};
      if (streamFilter) params.streamId = streamFilter;
      if (statusFilter) params.status = statusFilter;

      const [saData, streamsData] = await Promise.all([
        getStudentAssignments(accessToken, params),
        getStreams(accessToken),
      ]);
      setAssignments(saData.studentAssignments);
      setStreams(streamsData.streams.filter((s) => s.status === 'active'));
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка загрузки');
    } finally {
      setLoadingData(false);
    }
  }, [accessToken, streamFilter, statusFilter]);

  useEffect(() => {
    if (accessToken && user?.role === 'student') fetchData();
  }, [accessToken, user, fetchData]);

  const loadAssignmentFeedback = useCallback(
    async (assignmentId: string) => {
      if (!accessToken || !user || assignmentId in assignmentFeedback) return;
      try {
        const data = await getThread(accessToken, user.id, assignmentId);
        const adminComments = data.entries.filter(
          (e) => e.type === 'comment' && e.author.role === 'admin' && e.assignmentId === assignmentId,
        );
        const last = adminComments.length > 0 ? adminComments[adminComments.length - 1] : null;
        setAssignmentFeedback((prev) => ({ ...prev, [assignmentId]: last }));
      } catch {
        setAssignmentFeedback((prev) => ({ ...prev, [assignmentId]: null }));
      }
    },
    [accessToken, user, assignmentFeedback],
  );

  const handleToggleExpand = (saId: string, assignmentId: string | undefined, isReviewed: boolean) => {
    const nextExpanded = expandedId === saId ? null : saId;
    setExpandedId(nextExpanded);
    if (nextExpanded && isReviewed && assignmentId) {
      loadAssignmentFeedback(assignmentId);
    }
  };

  const openSubmissionForm = (saId: string) => {
    const target = assignments.find((s) => s.id === saId);
    setSubmissionModalSaId(saId);
    // При правке уже отправленной (submitted) работы предзаполняем прошлый ответ.
    setSubmissionText(target?.status === 'submitted' ? target.content ?? '' : '');
    setSubmissionFile(null);
  };

  const closeSubmissionForm = () => {
    setSubmissionModalSaId(null);
    setSubmissionText('');
    setSubmissionFile(null);
  };

  const handleSubmit = async () => {
    if (!accessToken || !submissionModalSaId) return;
    const isResubmit =
      assignments.find((s) => s.id === submissionModalSaId)?.status === 'submitted';
    setSubmitting(true);
    try {
      await submitStudentAssignment(accessToken, submissionModalSaId, {
        answerText: submissionText || undefined,
        file: submissionFile || undefined,
      });
      toast.success(isResubmit ? 'Ответ обновлён' : 'Задание отправлено на проверку');
      closeSubmissionForm();
      await fetchData();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Ошибка отправки');
    } finally {
      setSubmitting(false);
    }
  };

  // Группировка (Уровень 2): по группе/программе → внутри по номеру урока (01→06).
  // Уроки без распознанного номера — в конец группы. Группы упорядочены по названию.
  const groups = useMemo(() => {
    const sorted = [...assignments].sort((x, y) => {
      const nx = lessonNumber(x.assignment?.lesson?.title);
      const ny = lessonNumber(y.assignment?.lesson?.title);
      if (nx !== ny) {
        if (nx == null) return 1;
        if (ny == null) return -1;
        return nx - ny;
      }
      return (x.assignment?.title ?? '').localeCompare(y.assignment?.title ?? '', 'ru');
    });
    const map = new Map<string, { key: string; name: string; items: StudentAssignment[] }>();
    for (const sa of sorted) {
      const key = sa.assignment?.stream?.id ?? 'none';
      const name = sa.assignment?.stream?.name ?? 'Без группы';
      const g = map.get(key) ?? { key, name, items: [] };
      g.items.push(sa);
      map.set(key, g);
    }
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name, 'ru'));
  }, [assignments]);

  // «Сейчас» — первое незакрытое задание (Назначено/На доработке) в каждой группе по
  // порядку уроков: подсказка «что делать дальше» в рамках программы.
  const currentIds = useMemo(() => {
    const set = new Set<string>();
    for (const g of groups) {
      const next = g.items.find(
        (sa) => sa.status === 'assigned' || sa.status === 'needs_revision',
      );
      if (next) set.add(next.id);
    }
    return set;
  }, [groups]);

  return (
    <>
      <div className="max-w-3xl">
        {/* Page header */}
        <div className="mb-8">
          <button
            type="button"
            onClick={goBack}
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors mb-3"
          >
            <ChevronLeft className="size-3.5" />
            Назад
          </button>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            Мои задания
          </h1>
          <p className="text-xs text-muted-foreground mt-1">
            {assignments.length} задани
            {assignments.length === 1 ? 'е' : assignments.length < 5 ? 'я' : 'й'}
          </p>
        </div>

        {/* Alerts */}
        {error && (
          <Alert variant="destructive" className="mb-4">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {/* Filters */}
        <div className="flex gap-3 mb-5 flex-wrap">
          <Select
            value={streamFilter || 'all'}
            onValueChange={(v) => setStreamFilter(v === 'all' ? '' : v)}
          >
            <SelectTrigger className="min-w-40">
              <SelectValue placeholder="Все группы" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Все группы</SelectItem>
              {streams.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select
            value={statusFilter || 'all'}
            onValueChange={(v) => setStatusFilter(v === 'all' ? '' : v)}
          >
            <SelectTrigger className="min-w-40">
              <SelectValue placeholder="Все статусы" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Все статусы</SelectItem>
              {STATUS_ORDER.map((s) => (
                <SelectItem key={s} value={s}>
                  {STATUS_LABELS[s]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {(streamFilter || statusFilter) && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setStreamFilter('');
                setStatusFilter('');
              }}
            >
              <X className="size-3.5" />
              Сбросить
            </Button>
          )}
        </div>

        {/* Content */}
        {loadingData ? (
          <div className="flex justify-center py-16">
            <Loader2 className="size-8 animate-spin text-muted-foreground" />
          </div>
        ) : assignments.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 py-16 rounded-lg border border-dashed">
            <div className="size-12 rounded-full border-2 flex items-center justify-center text-muted-foreground">
              <ClipboardList className="size-5" />
            </div>
            <p className="text-xs text-muted-foreground m-0">
              {statusFilter || streamFilter ? 'Нет заданий по фильтрам' : 'Заданий пока нет'}
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-8">
            {groups.map((group) => (
              <section key={group.key} className="flex flex-col gap-2">
                {/* Заголовок-секция группы/программы (Уровень 2). */}
                <h2 className="px-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  {group.name}
                  <span className="ml-2 normal-case tracking-normal text-muted-foreground/60">
                    {group.items.length}
                  </span>
                </h2>
                {group.items.map((sa) => {
              const a = sa.assignment;
              const lessonNo = lessonNumber(a?.lesson?.title);
              const isExpanded = expandedId === sa.id;
              const isCurrent = currentIds.has(sa.id);
              const isOverdue =
                a?.dueDate &&
                new Date(a.dueDate) < new Date() &&
                (sa.status === 'assigned' || sa.status === 'needs_revision');

              return (
                <div
                  key={sa.id}
                  className={`rounded-lg border bg-card overflow-hidden transition-colors ${
                    isOverdue ? 'border-destructive' : ''
                  }`}
                >
                  {/* Card header */}
                  <button
                    onClick={() => handleToggleExpand(sa.id, a?.id, sa.status === 'reviewed')}
                    aria-expanded={isExpanded}
                    className={`w-full px-5 py-4 cursor-pointer flex justify-between items-center border-0 text-left gap-4 transition-colors ${
                      isExpanded ? 'bg-muted' : 'bg-transparent'
                    }`}
                  >
                    {/* Якорь карточки — номер урока (01→06). Сортировка идёт по нему,
                        поэтому он вынесен влево крупным, а не мелкой сноской внизу. */}
                    <div className="shrink-0 self-start flex flex-col items-center justify-center rounded-md border bg-muted px-2.5 py-1.5 min-w-[3rem]">
                      <span className="text-[10px] uppercase tracking-wide text-muted-foreground leading-none">
                        Урок
                      </span>
                      <span className="mt-0.5 text-lg font-semibold tabular-nums leading-none text-foreground">
                        {lessonNo != null ? String(lessonNo).padStart(2, '0') : '—'}
                      </span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-base text-foreground overflow-hidden text-ellipsis whitespace-nowrap mb-2">
                        {a?.title}
                      </div>
                      <div className="flex gap-2 items-center flex-wrap">
                        {/* Статус — главный сигнал, цветом (Уровень 2). Шумные бейджи
                            «Длинное»/«Индивидуальное» убраны; группа — в заголовке секции. */}
                        <Badge variant="secondary" className={statusBadgeClass(sa.status)}>
                          {STATUS_LABELS[sa.status]}
                        </Badge>
                        {isOverdue ? (
                          <Badge
                            variant="secondary"
                            className="border-transparent bg-destructive/15 text-destructive"
                          >
                            Просрочено
                          </Badge>
                        ) : (
                          isCurrent && (
                            <Badge
                              variant="secondary"
                              className="border-transparent bg-primary/15 text-primary"
                            >
                              Сейчас
                            </Badge>
                          )
                        )}
                        {a?.lesson && (
                          <span className="text-xs text-muted-foreground">
                            {a.lesson.title}
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="flex gap-4 items-center shrink-0">
                      {a?.dueDate && (
                        <div className="text-right text-xs">
                          <div className="uppercase text-muted-foreground mb-0.5">
                            Дедлайн
                          </div>
                          <div
                            className={isOverdue ? 'text-destructive font-semibold' : 'text-muted-foreground'}
                          >
                            {new Date(a.dueDate).toLocaleString('ru-RU', {
                              dateStyle: 'short',
                              timeStyle: 'short',
                            })}
                          </div>
                        </div>
                      )}
                      <ChevronDown
                        className={`size-4 text-muted-foreground transition-transform ${
                          isExpanded ? 'rotate-180' : ''
                        }`}
                      />
                    </div>
                  </button>

                  {/* Expanded content */}
                  {isExpanded && (
                    <div className="px-5 py-4 border-t">
                      {a?.description ? (
                        <div className="mb-4">
                          <p className="text-xs uppercase text-muted-foreground mb-2">
                            Описание
                          </p>
                          <p className="whitespace-pre-wrap m-0 text-sm leading-relaxed text-muted-foreground">
                            {a.description}
                          </p>
                        </div>
                      ) : (
                        <p className="text-muted-foreground text-sm italic mb-4">
                          Описание не указано
                        </p>
                      )}

                      {a?.materials && a.materials.length > 0 && (
                        <div className="mb-4">
                          <p className="text-xs uppercase text-muted-foreground mb-2">
                            Материалы
                          </p>
                          <div className="flex flex-col gap-2">
                            {a.materials.map((m, i) => (
                              <a
                                key={i}
                                href={m.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                download={m.type === 'file' ? m.name : undefined}
                                // Файловые материалы качаются → трекаем как 'downloaded'
                                // (ссылки и задания без урока/потока пропускаем).
                                onClick={
                                  m.type === 'file' && m.s3Key && a.lessonId && a.streamId
                                    ? () =>
                                        trackMaterialAccess(accessToken!, a.lessonId!, {
                                          streamId: a.streamId,
                                          s3Key: m.s3Key!,
                                          accessType: 'downloaded',
                                        })
                                    : undefined
                                }
                                className="flex items-center gap-2 px-3 py-2 rounded-md bg-muted border text-primary no-underline text-sm transition-opacity hover:opacity-80"
                              >
                                {m.type === 'file' ? (
                                  <FileText className="size-3.5 shrink-0" />
                                ) : (
                                  <ExternalLink className="size-3.5 shrink-0" />
                                )}
                                <span className="flex-1 overflow-hidden text-ellipsis whitespace-nowrap">
                                  {m.name}
                                </span>
                                {m.type === 'file' && m.size && (
                                  <span className="text-xs text-muted-foreground shrink-0">
                                    {Math.round(m.size / 1024)}KB
                                  </span>
                                )}
                                <span className="text-xs text-muted-foreground shrink-0 uppercase">
                                  {m.type === 'file' ? 'Скачать' : 'Открыть'}
                                </span>
                              </a>
                            ))}
                          </div>
                        </div>
                      )}

                      {a?.tags && a.tags.length > 0 && (
                        <div className="flex gap-1 flex-wrap mb-4">
                          {a.tags.map((tag) => (
                            <Badge key={tag} variant="secondary">
                              {tag}
                            </Badge>
                          ))}
                        </div>
                      )}

                      {/* Submitted answer */}
                      {(sa.status === 'submitted' || sa.status === 'reviewed') && sa.content && (
                        <div className="mb-4 px-4 py-3 rounded-md bg-muted border-l-[3px] border-primary">
                          <p className="text-xs uppercase text-muted-foreground mb-2">
                            Ваш ответ
                          </p>
                          <p className="whitespace-pre-wrap m-0 text-sm leading-relaxed text-muted-foreground italic">
                            {sa.content}
                          </p>
                        </div>
                      )}

                      {(sa.status === 'submitted' || sa.status === 'reviewed') && sa.fileName && (
                        <div className="mb-4 flex items-center gap-3 px-3 py-2 rounded-md bg-muted border">
                          <FileText className="size-4 shrink-0 text-muted-foreground" />
                          <div className="flex-1 min-w-0">
                            <div className="text-sm text-foreground overflow-hidden text-ellipsis whitespace-nowrap">
                              {sa.fileName}
                            </div>
                            {sa.fileSize && (
                              <div className="text-xs text-muted-foreground">
                                {sa.fileSize < 1024 * 1024
                                  ? `${Math.round(sa.fileSize / 1024)} КБ`
                                  : `${(sa.fileSize / (1024 * 1024)).toFixed(1)} МБ`}
                              </div>
                            )}
                          </div>
                          {sa.fileSignedUrl && (
                            <FileLightbox fileName={sa.fileName} url={sa.fileSignedUrl} />
                          )}
                        </div>
                      )}

                      {/* Teacher feedback */}
                      {sa.status === 'reviewed' &&
                        a?.id &&
                        (() => {
                          const feedback = assignmentFeedback[a.id];
                          if (feedback === undefined || feedback === null) return null;
                          return (
                            <div className="mb-4 p-4 rounded-md border bg-muted">
                              <div className="flex items-center gap-2 mb-3">
                                <MessageCircle className="size-3.5 text-primary" />
                                <span className="text-xs uppercase text-foreground font-medium">
                                  Фидбек учителя
                                </span>
                                <span className="text-xs text-muted-foreground ml-auto">
                                  {new Date(feedback.createdAt).toLocaleString('ru-RU', {
                                    dateStyle: 'short',
                                    timeStyle: 'short',
                                  })}{' '}
                                  · {feedback.author.name}
                                </span>
                              </div>
                              <p className="text-sm text-muted-foreground leading-relaxed whitespace-pre-wrap m-0">
                                {feedback.content}
                              </p>
                              <div className="flex gap-3 mt-3 pt-3 border-t">
                                <Button
                                  variant="link"
                                  size="sm"
                                  className="h-auto p-0"
                                  onClick={() =>
                                    router.push(
                                      `/dashboard/messages?tab=personal&assignmentId=${a.id}&title=${encodeURIComponent(a.title || '')}`,
                                    )
                                  }
                                >
                                  Открыть в сообщениях
                                </Button>
                              </div>
                            </div>
                          );
                        })()}

                      {/* Actions row: на мобиле в столбик (мета над кнопками),
                          на sm+ — в ряд с выравниванием по краям */}
                      <div className="flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
                        <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground">
                          {sa.submittedAt && (
                            <span>
                              Отправлено:{' '}
                              {new Date(sa.submittedAt).toLocaleString('ru-RU', {
                                dateStyle: 'short',
                                timeStyle: 'short',
                              })}
                            </span>
                          )}
                          {sa.reviewedAt && (
                            <span>
                              Проверено:{' '}
                              {new Date(sa.reviewedAt).toLocaleString('ru-RU', {
                                dateStyle: 'short',
                                timeStyle: 'short',
                              })}
                            </span>
                          )}
                        </div>

                        {/* На мобиле кнопки в столбик во всю ширину (тап-таргет ≥44px),
                            на sm+ — в ряд с переносом, чтобы ничего не обрезалось */}
                        <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:flex-wrap sm:items-center">
                          <Button
                            asChild
                            variant="outline"
                            size="sm"
                            className="w-full min-h-11 sm:w-auto sm:min-h-9"
                          >
                            <Link href={`/dashboard/assignments/${sa.id}`}>Подробнее</Link>
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            className="w-full min-h-11 sm:w-auto sm:min-h-9"
                            onClick={() =>
                              router.push(
                                `/dashboard/messages?tab=personal&assignmentId=${a?.id}&title=${encodeURIComponent(a?.title || '')}`,
                              )
                            }
                          >
                            <MessageCircle className="size-3.5" />
                            Задать вопрос
                          </Button>
                          {(sa.status === 'assigned' ||
                            sa.status === 'needs_revision' ||
                            sa.status === 'submitted') && (
                            <Button
                              size="sm"
                              variant={sa.status === 'submitted' ? 'outline' : 'default'}
                              className="w-full min-h-11 sm:w-auto sm:min-h-9"
                              onClick={() => openSubmissionForm(sa.id)}
                            >
                              {sa.status === 'needs_revision'
                                ? 'Пересдать'
                                : sa.status === 'submitted'
                                  ? 'Изменить'
                                  : 'Отправить'}
                            </Button>
                          )}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
                })}
              </section>
            ))}
          </div>
        )}
      </div>

      {/* Submission Modal */}
      <Dialog
        open={!!submissionModalSaId}
        onOpenChange={(open) => {
          if (!open) closeSubmissionForm();
        }}
      >
        <DialogContent className="sm:max-w-[520px]">
          {(() => {
            const modalSa = assignments.find((s) => s.id === submissionModalSaId);
            const modalAssignment = modalSa?.assignment;
            const isShort = modalAssignment?.type === 'short';
            const isResubmit = modalSa?.status === 'submitted';

            return (
              <>
                <DialogHeader>
                  <DialogTitle>{isResubmit ? 'Изменение ответа' : 'Сдача задания'}</DialogTitle>
                </DialogHeader>

                <div className="rounded-md bg-muted border p-3 px-4">
                  <div className="text-base font-medium text-foreground">
                    {modalAssignment?.title}
                  </div>
                  <div className="flex gap-2 mt-2 items-center">
                    {modalAssignment?.type && (
                      <Badge variant="outline">
                        {TYPE_LABELS[modalAssignment.type] ?? modalAssignment.type}
                      </Badge>
                    )}
                    {modalAssignment?.dueDate && (
                      <span className="text-xs text-muted-foreground">
                        Дедлайн:{' '}
                        {new Date(modalAssignment.dueDate).toLocaleString('ru-RU', {
                          dateStyle: 'short',
                          timeStyle: 'short',
                        })}
                      </span>
                    )}
                  </div>
                </div>

                <div className="flex flex-col gap-2">
                  <Label htmlFor="submission-text">
                    Ваш ответ {isShort && <span className="text-destructive">*</span>}
                  </Label>
                  <Textarea
                    id="submission-text"
                    value={submissionText}
                    onChange={(e) => setSubmissionText(e.target.value)}
                    placeholder="Опишите вашу работу кратко…"
                    maxLength={2000}
                    className="min-h-[140px] resize-none"
                  />
                  <div className="text-right text-xs text-muted-foreground">
                    {submissionText.length} / 2000
                  </div>
                </div>

                <div className="flex flex-col gap-2">
                  <Label>Файл</Label>
                  {/* При правке submitted показываем уже прикреплённый файл. */}
                  {isResubmit && !submissionFile && modalSa?.fileName && (
                    <p className="text-xs text-muted-foreground m-0">
                      Сейчас прикреплён: {modalSa.fileName}. Чтобы заменить — выберите новый файл ниже.
                    </p>
                  )}
                  {submissionFile ? (
                    <div className="flex items-center gap-3 px-3 py-2 rounded-md bg-muted border">
                      <Badge variant="outline">
                        {submissionFile.name.split('.').pop()?.toUpperCase()}
                      </Badge>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm overflow-hidden text-ellipsis whitespace-nowrap">
                          {submissionFile.name}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {submissionFile.size < 1024 * 1024
                            ? `${Math.round(submissionFile.size / 1024)} КБ`
                            : `${(submissionFile.size / (1024 * 1024)).toFixed(1)} МБ`}
                        </div>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-7"
                        onClick={() => setSubmissionFile(null)}
                      >
                        <X className="size-4" />
                      </Button>
                    </div>
                  ) : (
                    <label className="flex items-center justify-center gap-2 p-4 rounded-md border-2 border-dashed cursor-pointer text-sm text-muted-foreground hover:border-ring transition-colors">
                      <input
                        type="file"
                        accept=".md,.markdown,.txt,.pdf,.docx,.png,.jpg,.jpeg,.figma,.zip"
                        className="hidden"
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          if (f) {
                            if (f.size > 20 * 1024 * 1024) {
                              toast.error('Файл не должен превышать 20 МБ');
                              return;
                            }
                            setSubmissionFile(f);
                          }
                        }}
                      />
                      {isResubmit && modalSa?.fileName
                        ? '+ Заменить файл (PDF, DOCX, PNG — до 20 МБ)'
                        : '+ Прикрепить файл (PDF, DOCX, PNG — до 20 МБ)'}
                    </label>
                  )}
                </div>

                <p className="text-xs text-muted-foreground italic">
                  {isResubmit
                    ? 'Изменить ответ можно, пока работу не проверили.'
                    : 'После отправки потребуется подтверждение. Ответ нельзя изменить.'}
                </p>

                <DialogFooter>
                  <Button variant="secondary" size="sm" onClick={closeSubmissionForm}>
                    Отмена
                  </Button>
                  <Button
                    size="sm"
                    onClick={handleSubmit}
                    disabled={submitting || (isShort && !submissionText.trim())}
                  >
                    {submitting
                      ? 'Отправка…'
                      : isResubmit
                        ? 'Сохранить изменения →'
                        : 'Сдать задание →'}
                  </Button>
                </DialogFooter>
              </>
            );
          })()}
        </DialogContent>
      </Dialog>
    </>
  );
}
