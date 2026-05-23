'use client';

import { useEffect, useState, useCallback, use } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { Loader2, ChevronLeft, Calendar, FileText, ExternalLink, X, Upload, MessageCircle } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Separator } from '@/components/ui/separator';
import {
  getStudentAssignments,
  submitStudentAssignment,
  getThread,
  type StudentAssignment,
  type ThreadEntry,
} from '@/lib/api';
import { MarkdownLightbox, isMarkdownFile } from '@/components/assignments/markdown-lightbox';
import { STATUS_LABELS, STATUS_VARIANT } from '@/lib/assignment-status';
import Link from 'next/link';

const TYPE_LABELS: Record<string, string> = {
  short: 'Короткое',
  long: 'Длинное',
};

export default function AssignmentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const { user, accessToken } = useAuth();
  const router = useRouter();

  const [sa, setSa] = useState<StudentAssignment | null>(null);
  const [loadingData, setLoadingData] = useState(true);
  const [error, setError] = useState('');
  const [feedback, setFeedback] = useState<ThreadEntry | null | undefined>(undefined);

  const [submissionText, setSubmissionText] = useState('');
  const [submissionFile, setSubmissionFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [showForm, setShowForm] = useState(false);

  const fetchAssignment = useCallback(async () => {
    if (!accessToken) return;
    setLoadingData(true);
    try {
      const data = await getStudentAssignments(accessToken);
      const found = data.studentAssignments.find((item) => item.id === id);
      if (!found) {
        setError('Задание не найдено');
      } else {
        setSa(found);
        setError('');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка загрузки');
    } finally {
      setLoadingData(false);
    }
  }, [accessToken, id]);

  useEffect(() => {
    if (accessToken && user?.role === 'student') fetchAssignment();
  }, [accessToken, user, fetchAssignment]);

  const loadFeedback = useCallback(async () => {
    if (!accessToken || !user || !sa?.assignment?.id) return;
    try {
      const data = await getThread(accessToken, user.id, sa.assignment.id);
      const adminComments = data.entries.filter(
        (e) => e.type === 'comment' && e.author.role === 'admin' && e.assignmentId === sa.assignment?.id,
      );
      setFeedback(adminComments.length > 0 ? adminComments[adminComments.length - 1] : null);
    } catch {
      setFeedback(null);
    }
  }, [accessToken, user, sa]);

  useEffect(() => {
    if (sa?.status === 'reviewed') loadFeedback();
  }, [sa, loadFeedback]);

  // При редактировании уже отправленной (submitted) сдачи предзаполняем форму
  // прошлым текстом, чтобы студент правил, а не писал с нуля.
  const openForm = () => {
    setSubmissionText(sa?.status === 'submitted' ? sa.content ?? '' : '');
    setSubmissionFile(null);
    setShowForm(true);
  };

  const handleSubmit = async () => {
    if (!accessToken || !sa) return;
    const isResubmit = sa.status === 'submitted';
    setSubmitting(true);
    try {
      const updated = await submitStudentAssignment(accessToken, sa.id, {
        answerText: submissionText || undefined,
        file: submissionFile || undefined,
      });
      setSa(updated.studentAssignment);
      toast.success(isResubmit ? 'Ответ обновлён' : 'Задание отправлено на проверку');
      setShowForm(false);
      setSubmissionText('');
      setSubmissionFile(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Ошибка отправки');
    } finally {
      setSubmitting(false);
    }
  };

  if (loadingData) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="size-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const a = sa?.assignment;
  const isOverdue = sa && a?.dueDate && new Date(a.dueDate) < new Date() && (sa.status === 'assigned' || sa.status === 'needs_revision');
  const isShort = a?.type === 'short';

  return (
    <>
      <div className="max-w-2xl">
        {/* Back */}
        <Link
          href="/dashboard/assignments"
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors mb-6 no-underline"
        >
          <ChevronLeft className="size-3.5" />
          К заданиям
        </Link>

        {error && !sa && (
          <Alert variant="destructive" className="mb-6">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {sa && (
          <>
            {/* Header */}
            <div className="mb-8">
              <div className="flex items-start gap-3 mb-3 flex-wrap">
                <Badge variant={STATUS_VARIANT[sa.status] ?? 'default'}>
                  {STATUS_LABELS[sa.status]}
                </Badge>
                {a?.type && <Badge variant="outline">{TYPE_LABELS[a.type] ?? a.type}</Badge>}
                {a && !a.groupId && <Badge variant="secondary">Индивидуальное</Badge>}
              </div>
              <h1 className="text-2xl font-semibold tracking-tight text-foreground mb-2">
                {a?.title ?? '—'}
              </h1>
              <div className="flex gap-4 flex-wrap">
                {a?.stream && (
                  <span className="text-xs text-muted-foreground uppercase">
                    {a.stream.name}
                  </span>
                )}
                {a?.lesson && (
                  <span className="text-xs text-muted-foreground">
                    Урок: {a.lesson.title}
                  </span>
                )}
              </div>
            </div>

            {/* Meta row */}
            {a?.dueDate && (
              <div className="flex items-center gap-3 mb-6 p-3 rounded-md border bg-card">
                <Calendar className="size-3.5 text-muted-foreground shrink-0" />
                <div className="text-xs">
                  <span className="text-muted-foreground uppercase mr-2">Дедлайн</span>
                  <span className={isOverdue ? 'text-destructive' : 'text-muted-foreground'}>
                    {new Date(a.dueDate).toLocaleString('ru-RU', { dateStyle: 'long', timeStyle: 'short' })}
                  </span>
                  {isOverdue && (
                    <span className="ml-2 text-destructive uppercase font-bold">— просрочено</span>
                  )}
                </div>
              </div>
            )}

            {/* Description */}
            {a?.description ? (
              <section className="mb-6">
                <h2 className="text-xs uppercase text-muted-foreground mb-3">
                  Описание
                </h2>
                <p className="whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground m-0">
                  {a.description}
                </p>
              </section>
            ) : (
              <section className="mb-6">
                <p className="text-sm text-muted-foreground italic">Описание не указано</p>
              </section>
            )}

            {/* Materials */}
            {a?.materials && a.materials.length > 0 && (
              <section className="mb-6">
                <h2 className="text-xs uppercase text-muted-foreground mb-3">
                  Материалы
                </h2>
                <div className="flex flex-col gap-2">
                  {a.materials.map((m, i) => (
                    <a
                      key={i}
                      href={m.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      download={m.type === 'file' ? m.name : undefined}
                      className="flex items-center gap-2 px-3 py-2 rounded-md bg-muted border text-primary no-underline text-sm hover:opacity-80 transition-opacity"
                    >
                      {m.type === 'file' ? (
                        <FileText className="size-3.5 shrink-0" />
                      ) : (
                        <ExternalLink className="size-3.5 shrink-0" />
                      )}
                      <span className="flex-1 overflow-hidden text-ellipsis whitespace-nowrap">{m.name}</span>
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
              </section>
            )}

            {/* Критерии оценки — что требуется для зачёта. Видны до сдачи. */}
            {a?.criteria && (
              <section className="mb-6">
                <h2 className="text-xs uppercase text-muted-foreground mb-3">
                  Критерии оценки
                </h2>
                <div className="px-4 py-3 rounded-md bg-muted border">
                  <p className="whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground m-0">
                    {a.criteria}
                  </p>
                </div>
              </section>
            )}

            {/* Tags */}
            {a?.tags && a.tags.length > 0 && (
              <div className="flex gap-1 flex-wrap mb-6">
                {a.tags.map((tag) => (
                  <Badge key={tag} variant="secondary">
                    {tag}
                  </Badge>
                ))}
              </div>
            )}

            {/* Divider */}
            <Separator className="my-6" />

            {/* Submitted answer. При needs_revision показываем ПРОШЛУЮ сдачу,
                чтобы студент видел, что отправлял, при доработке. */}
            {(sa.status === 'submitted' || sa.status === 'reviewed' || sa.status === 'needs_revision') && (
              <section className="mb-6">
                <h2 className="text-xs uppercase text-muted-foreground mb-3">
                  {sa.status === 'needs_revision' ? 'Ваш прошлый ответ' : 'Ваш ответ'}
                </h2>
                {sa.content && (
                  <div className="px-4 py-3 rounded-md bg-muted border-l-[3px] border-primary mb-3">
                    <p className="whitespace-pre-wrap m-0 text-sm leading-relaxed text-muted-foreground italic">
                      {sa.content}
                    </p>
                  </div>
                )}
                {sa.fileName && (
                  <div className="flex items-center gap-3 px-3 py-2 rounded-md bg-muted border">
                    <FileText className="size-4 text-muted-foreground shrink-0" />
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
                      <div className="flex shrink-0 items-center gap-1">
                        {isMarkdownFile(sa.fileName) && (
                          <MarkdownLightbox fileName={sa.fileName!} url={sa.fileSignedUrl} />
                        )}
                        <a
                          href={sa.fileSignedUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-primary no-underline"
                        >
                          Открыть ↗
                        </a>
                      </div>
                    )}
                  </div>
                )}
                {sa.submittedAt && (
                  <p className="text-xs text-muted-foreground mt-2">
                    Отправлено: {new Date(sa.submittedAt).toLocaleString('ru-RU', { dateStyle: 'long', timeStyle: 'short' })}
                  </p>
                )}
              </section>
            )}

            {/* Разбор работы: вердикт + текст разбора + автор. Виден после проверки
                (и при «прошёл», и при «не прошёл, на доработку»). */}
            {(sa.status === 'reviewed' || sa.status === 'needs_revision') && (sa.reviewText || sa.reviewedBy) && (
              <section className="mb-6">
                <Alert variant={sa.status === 'reviewed' ? 'default' : 'destructive'}>
                  <AlertDescription>
                    <div className="flex flex-col gap-2">
                      <span className="text-sm font-semibold text-foreground">
                        {sa.status === 'reviewed' ? 'Прошёл' : 'Не прошёл, на доработку'}
                      </span>
                      {sa.reviewText && (
                        <p className="text-sm leading-relaxed whitespace-pre-wrap m-0 text-muted-foreground">
                          {sa.reviewText}
                        </p>
                      )}
                      {sa.reviewedBy && (
                        <span className="text-xs text-muted-foreground">
                          Проверил: {sa.reviewedBy}
                        </span>
                      )}
                      {sa.reviewedAt && (
                        <span className="text-xs text-muted-foreground">
                          Проверено: {new Date(sa.reviewedAt).toLocaleString('ru-RU', { dateStyle: 'long', timeStyle: 'short' })}
                        </span>
                      )}
                    </div>
                  </AlertDescription>
                </Alert>
              </section>
            )}

            {/* Дополнительный фидбек учителя из переписки (если оставлен комментарий к работе). */}
            {sa.status === 'reviewed' && feedback && (
              <section className="mb-6">
                <div className="p-4 rounded-md border bg-muted">
                  <div className="flex items-center gap-2 mb-3">
                    <MessageCircle className="size-3.5 text-primary" />
                    <span className="text-xs uppercase text-foreground font-medium">
                      Фидбек учителя
                    </span>
                    <span className="text-xs text-muted-foreground ml-auto">
                      {new Date(feedback.createdAt).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' })} · {feedback.author.name}
                    </span>
                  </div>
                  <p className="text-sm text-muted-foreground leading-relaxed whitespace-pre-wrap m-0">
                    {feedback.content}
                  </p>
                </div>
              </section>
            )}

            {/* Submission form: кнопки запуска.
                - assigned → «Сдать задание»
                - needs_revision → «Пересдать задание» (отдельный путь доработки)
                - submitted → «Изменить ответ» (пока не проверено — можно править/дослать) */}
            {(sa.status === 'assigned' || sa.status === 'needs_revision' || sa.status === 'submitted') && !showForm && (
              <div className="flex gap-3">
                <Button onClick={openForm}>
                  {sa.status === 'needs_revision'
                    ? 'Пересдать задание'
                    : sa.status === 'submitted'
                      ? 'Изменить ответ'
                      : 'Сдать задание'}
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => router.push(`/dashboard/messages?tab=personal&assignmentId=${a?.id}&title=${encodeURIComponent(a?.title || '')}`)}
                >
                  Задать вопрос
                </Button>
              </div>
            )}

            {showForm && (
              <section>
                <h2 className="text-xs uppercase text-muted-foreground mb-4">
                  {sa.status === 'needs_revision'
                    ? 'Пересдача задания'
                    : sa.status === 'submitted'
                      ? 'Изменение ответа'
                      : 'Сдача задания'}
                </h2>

                {/* Answer */}
                <div className="flex flex-col gap-2 mb-4">
                  <Label htmlFor="submission-text">
                    Ваш ответ {isShort && <span className="text-destructive">*</span>}
                  </Label>
                  <Textarea
                    id="submission-text"
                    value={submissionText}
                    onChange={(e) => setSubmissionText(e.target.value)}
                    placeholder="Опишите вашу работу кратко…"
                    maxLength={2000}
                    className="min-h-[160px] resize-none"
                  />
                  <div className="text-right text-xs text-muted-foreground">
                    {submissionText.length} / 2000
                  </div>
                </div>

                {/* File */}
                <div className="flex flex-col gap-2 mb-6">
                  <Label>Файл</Label>
                  {/* При правке submitted показываем уже прикреплённый файл —
                      его можно оставить как есть или заменить, дослав новый. */}
                  {sa.status === 'submitted' && !submissionFile && sa.fileName && (
                    <p className="text-xs text-muted-foreground m-0">
                      Сейчас прикреплён: {sa.fileName}. Чтобы заменить — выберите новый файл ниже.
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
                    <label className="flex items-center justify-center gap-2 p-6 rounded-md border-2 border-dashed cursor-pointer text-sm text-muted-foreground hover:border-ring transition-colors">
                      <input
                        type="file"
                        accept=".pdf,.docx,.png,.jpg,.jpeg,.figma,.zip"
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
                      <Upload className="size-4" />
                      {sa.status === 'submitted' && sa.fileName
                        ? 'Заменить файл (PDF, DOCX, PNG — до 20 МБ)'
                        : 'Прикрепить файл (PDF, DOCX, PNG — до 20 МБ)'}
                    </label>
                  )}
                </div>

                <p className="text-xs text-muted-foreground italic mb-4">
                  {sa.status === 'submitted'
                    ? 'Изменить ответ можно, пока работу не проверили.'
                    : 'После отправки ответ нельзя изменить.'}
                </p>

                <div className="flex gap-3">
                  <Button
                    onClick={handleSubmit}
                    disabled={submitting || (isShort && !submissionText.trim())}
                  >
                    {submitting
                      ? 'Отправка…'
                      : sa.status === 'submitted'
                        ? 'Сохранить изменения →'
                        : 'Сдать задание →'}
                  </Button>
                  <Button
                    variant="secondary"
                    onClick={() => {
                      setShowForm(false);
                      setSubmissionText('');
                      setSubmissionFile(null);
                    }}
                  >
                    Отмена
                  </Button>
                </div>
              </section>
            )}

            {/* Thread link */}
            {(sa.status === 'submitted' || sa.status === 'reviewed') && (
              <div className="mt-6 pt-6 border-t">
                <Button
                  variant="link"
                  className="h-auto p-0"
                  onClick={() => router.push(`/dashboard/messages?tab=personal&assignmentId=${a?.id}&title=${encodeURIComponent(a?.title || '')}`)}
                >
                  <MessageCircle className="size-3.5" />
                  Открыть в сообщениях
                </Button>
              </div>
            )}
          </>
        )}
      </div>
    </>
  );
}
