'use client';

import { Suspense, useEffect, useState, useCallback } from 'react';
import { useSearchParams } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { getStreams, getLessons, type Stream, type Lesson } from '@/lib/api';
import { PageHeader } from '@platform/ui/templates';
import { Spinner } from '@platform/ui/atoms';

function MaterialsContent() {
  const { user, accessToken } = useAuth();
  const searchParams = useSearchParams();

  const [streams, setStreams] = useState<Stream[]>([]);
  const [selectedStreamId, setSelectedStreamId] = useState<string>(searchParams.get('streamId') || '');
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [loadingData, setLoadingData] = useState(true);
  const [error, setError] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    if (!accessToken || !user) return;
    getStreams(accessToken)
      .then((data) => {
        const active = data.streams.filter((s) => s.status === 'active');
        setStreams(active);
        if (!selectedStreamId && active.length > 0) {
          setSelectedStreamId(active[0].id);
        }
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Ошибка загрузки потоков'));
  }, [accessToken, user, selectedStreamId]);

  const fetchLessons = useCallback(async () => {
    if (!accessToken || !selectedStreamId) return;
    setLoadingData(true);
    try {
      const data = await getLessons(accessToken, selectedStreamId);
      setLessons(data.lessons.filter((l) => l.status === 'published'));
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка загрузки материалов');
    } finally {
      setLoadingData(false);
    }
  }, [accessToken, selectedStreamId]);

  useEffect(() => {
    if (selectedStreamId) fetchLessons();
  }, [selectedStreamId, fetchLessons]);

  const lessonsWithMaterials = lessons.filter(
    (l) => l.videoUrl || l.summary || l.notes,
  );
  const lessonsWithoutMaterials = lessons.filter(
    (l) => !l.videoUrl && !l.summary && !l.notes,
  );

  return (
    <>
      <PageHeader
        title="Учебные материалы"
        subtitle="Конспекты, видеозаписи и заметки к урокам"
        action={
          streams.length > 1 ? (
            <select
              value={selectedStreamId}
              onChange={(e) => { setSelectedStreamId(e.target.value); setExpandedId(null); }}
              className="px-3 py-2 bg-[var(--color-bg-surface)] border border-[var(--color-border-default)] text-[var(--color-text-primary)] font-mono text-xs uppercase tracking-wider focus:outline-none focus:border-[var(--color-accent-red)]"
            >
              {streams.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          ) : undefined
        }
      />

      {/* Error */}
      {error && (
        <div className="mb-6 px-4 py-3 border border-[var(--color-error)] bg-[var(--color-error-dim)]">
          <p className="font-sans text-sm text-[var(--color-error)]">{error}</p>
        </div>
      )}

      {/* Stats bar */}
      {!loadingData && lessons.length > 0 && (
        <div className="mb-6 flex items-center gap-6 border-b border-[var(--color-border-subtle)] pb-4">
          <div className="text-center">
            <p className="font-mono text-xl font-bold text-[var(--color-text-primary)]">{lessons.length}</p>
            <p className="font-mono text-xs text-[var(--color-text-tertiary)] uppercase tracking-wider mt-0.5">Уроков</p>
          </div>
          <div className="w-px h-8 bg-[var(--color-border-subtle)]" />
          <div className="text-center">
            <p className="font-mono text-xl font-bold text-[var(--color-accent-red)]">{lessonsWithMaterials.length}</p>
            <p className="font-mono text-xs text-[var(--color-text-tertiary)] uppercase tracking-wider mt-0.5">С материалами</p>
          </div>
          <div className="w-px h-8 bg-[var(--color-border-subtle)]" />
          <div className="text-center">
            <p className="font-mono text-xl font-bold text-[var(--color-text-secondary)]">
              {lessons.filter((l) => l.videoUrl).length}
            </p>
            <p className="font-mono text-xs text-[var(--color-text-tertiary)] uppercase tracking-wider mt-0.5">Видео</p>
          </div>
        </div>
      )}

      {loadingData ? (
        <div className="flex justify-center py-16">
          <Spinner size="md" />
        </div>
      ) : lessons.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 gap-4">
          <div className="w-12 h-12 border border-[var(--color-border-default)] flex items-center justify-center text-[var(--color-text-disabled)]">
            <FolderIcon size={24} />
          </div>
          <p className="font-mono text-xs text-[var(--color-text-tertiary)] uppercase tracking-widest">
            Материалов пока нет
          </p>
          <p className="font-sans text-sm text-[var(--color-text-disabled)] text-center max-w-xs">
            Преподаватель ещё не добавил материалы к урокам этого потока
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {/* Lessons with materials */}
          {lessonsWithMaterials.map((lesson, idx) => (
            <LessonCard
              key={lesson.id}
              lesson={lesson}
              index={idx + 1}
              expanded={expandedId === lesson.id}
              onToggle={() => setExpandedId(expandedId === lesson.id ? null : lesson.id)}
            />
          ))}

          {/* Lessons without materials — collapsed footer */}
          {lessonsWithoutMaterials.length > 0 && (
            <div className="mt-6 border border-dashed border-[var(--color-border-subtle)] px-5 py-4">
              <p className="font-mono text-xs text-[var(--color-text-disabled)] uppercase tracking-wider">
                {lessonsWithoutMaterials.length} {lessonsWithoutMaterials.length === 1 ? 'урок' : 'уроков'} без материалов
              </p>
              <div className="mt-2 space-y-1">
                {lessonsWithoutMaterials.map((l) => (
                  <p key={l.id} className="font-sans text-xs text-[var(--color-text-disabled)]">
                    · {l.title}
                  </p>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </>
  );
}

function LessonCard({
  lesson,
  index,
  expanded,
  onToggle,
}: {
  lesson: Lesson;
  index: number;
  expanded: boolean;
  onToggle: () => void;
}) {
  const hasVideo = !!lesson.videoUrl;
  const hasSummary = !!lesson.summary;
  const hasNotes = !!lesson.notes;

  return (
    <div className={`border ${expanded ? 'border-[var(--color-accent-red)]' : 'border-[var(--color-border-default)]'} bg-[var(--color-bg-surface)] transition-colors duration-150`}>
      {/* Header row */}
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-4 px-5 py-4 text-left hover:bg-[var(--color-bg-elevated)] transition-colors duration-150 focus:outline-none"
      >
        {/* Index dot */}
        <span className="flex-shrink-0 w-7 h-7 flex items-center justify-center border border-[var(--color-border-strong)] font-mono text-xs text-[var(--color-text-tertiary)]">
          {String(index).padStart(2, '0')}
        </span>

        {/* Title */}
        <span className="flex-1 font-sans text-sm font-medium text-[var(--color-text-primary)] truncate">
          {lesson.title}
        </span>

        {/* Material badges */}
        <div className="flex-shrink-0 flex items-center gap-2">
          {hasVideo && (
            <span className="px-1.5 py-0.5 border border-[var(--color-accent-red)] font-mono text-[10px] text-[var(--color-accent-red)] uppercase tracking-wider">
              VID
            </span>
          )}
          {hasSummary && (
            <span className="px-1.5 py-0.5 border border-[var(--color-border-strong)] font-mono text-[10px] text-[var(--color-text-tertiary)] uppercase tracking-wider">
              TXT
            </span>
          )}
          {hasNotes && (
            <span className="px-1.5 py-0.5 border border-[var(--color-border-strong)] font-mono text-[10px] text-[var(--color-text-secondary)] uppercase tracking-wider">
              NTS
            </span>
          )}
        </div>

        {/* Expand icon */}
        <svg
          className={`flex-shrink-0 text-[var(--color-text-tertiary)] transition-transform duration-150 ${expanded ? 'rotate-180' : ''}`}
          width="16"
          height="16"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
        >
          <path d="M4 6l4 4 4-4" />
        </svg>
      </button>

      {/* Expanded content */}
      {expanded && (
        <div className="border-t border-[var(--color-border-subtle)] px-5 py-5 space-y-5 bg-[var(--color-bg-elevated)]">
          {/* Video */}
          {hasVideo && (
            <div>
              <p className="font-mono text-[10px] uppercase tracking-widest text-[var(--color-accent-red)] mb-3">
                Видеозапись
              </p>
              <a
                href={lesson.videoUrl!}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 px-4 py-2.5 border border-[var(--color-accent-red)] text-[var(--color-accent-red)] font-mono text-xs uppercase tracking-wider hover:bg-[var(--color-accent-red-dim)] transition-colors duration-150 focus:outline-none"
              >
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <polygon points="5,2 12,7 5,12" fill="currentColor" stroke="none" />
                </svg>
                Открыть видео
              </a>
            </div>
          )}

          {/* Summary */}
          {hasSummary && (
            <div>
              <p className="font-mono text-[10px] uppercase tracking-widest text-[var(--color-text-tertiary)] mb-3">
                Конспект
              </p>
              <div className="border-l-2 border-[var(--color-border-strong)] pl-4">
                <p className="font-sans text-sm text-[var(--color-text-secondary)] leading-relaxed whitespace-pre-wrap">
                  {lesson.summary}
                </p>
              </div>
            </div>
          )}

          {/* Notes */}
          {hasNotes && (
            <div>
              <p className="font-mono text-[10px] uppercase tracking-widest text-[var(--color-text-tertiary)] mb-3">
                Заметки преподавателя
              </p>
              <div className="border-l-2 border-[var(--color-accent-neon)] pl-4">
                <p className="font-sans text-sm text-[var(--color-text-secondary)] leading-relaxed whitespace-pre-wrap">
                  {lesson.notes}
                </p>
              </div>
            </div>
          )}

          {/* Metadata */}
          <div className="pt-2 border-t border-[var(--color-border-subtle)] flex items-center gap-4">
            {lesson.publishAt && (
              <p className="font-mono text-[10px] text-[var(--color-text-disabled)] uppercase tracking-wider">
                {new Date(lesson.publishAt).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })}
              </p>
            )}
            <button
              onClick={() => window.open(`/dashboard/lessons?streamId=${lesson.streamId}`, '_self')}
              className="font-mono text-[10px] text-[var(--color-text-tertiary)] uppercase tracking-wider hover:text-[var(--color-accent-red)] transition-colors duration-150 ml-auto"
            >
              Все уроки →
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function MaterialsPage() {
  return (
    <Suspense fallback={
      <div className="flex items-center justify-center min-h-screen bg-[var(--color-bg-base)]">
        <Spinner size="lg" />
      </div>
    }>
      <MaterialsContent />
    </Suspense>
  );
}

// ─── Icons ───────────────────────────────────────────────────────────
function FolderIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M1 4h5l2 2h7v8H1z" />
    </svg>
  );
}
