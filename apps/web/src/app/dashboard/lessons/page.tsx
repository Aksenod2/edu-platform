'use client';

import { Suspense, useEffect, useState, useCallback } from 'react';
import { useSearchParams } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import {
  getStreams,
  getLessons,
  type Stream,
  type Lesson,
} from '@/lib/api';
import { PageHeader } from '@platform/ui/templates';
import { Card, CardBody } from '@platform/ui/molecules';
import { Button } from '@platform/ui/atoms';
import { Badge } from '@platform/ui/atoms';
import { Heading, Text, Mono } from '@platform/ui/atoms';
import { Spinner } from '@platform/ui/atoms';

function StudentLessonsContent() {
  const { user, accessToken } = useAuth();
  const searchParams = useSearchParams();
  const streamIdParam = searchParams.get('streamId');

  const [streams, setStreams] = useState<Stream[]>([]);
  const [selectedStreamId, setSelectedStreamId] = useState<string | null>(streamIdParam);
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [loadingData, setLoadingData] = useState(true);
  const [expandedLessonId, setExpandedLessonId] = useState<string | null>(null);
  const [error, setError] = useState('');

  const fetchStreams = useCallback(async () => {
    if (!accessToken) return;
    try {
      const data = await getStreams(accessToken);
      setStreams(data.streams);
      if (!selectedStreamId && data.streams.length > 0) {
        setSelectedStreamId(data.streams[0].id);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка загрузки потоков');
    }
  }, [accessToken, selectedStreamId]);

  const fetchLessons = useCallback(async () => {
    if (!accessToken || !selectedStreamId) return;
    setLoadingData(true);
    try {
      const data = await getLessons(accessToken, selectedStreamId);
      setLessons(data.lessons);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка загрузки уроков');
    } finally {
      setLoadingData(false);
    }
  }, [accessToken, selectedStreamId]);

  useEffect(() => {
    if (accessToken && user?.role === 'student') {
      fetchStreams();
    }
  }, [accessToken, user, fetchStreams]);

  useEffect(() => {
    if (selectedStreamId) {
      fetchLessons();
    }
  }, [selectedStreamId, fetchLessons]);

  return (
    <>
      <PageHeader
        title="Уроки"
        subtitle="Видеозаписи, конспекты, материалы"
        action={
          streams.length > 1 ? (
            <select
              value={selectedStreamId || ''}
              onChange={(e) => {
                setSelectedStreamId(e.target.value);
                setExpandedLessonId(null);
              }}
              style={{
                padding: 'var(--spacing-2) var(--spacing-4)',
                background: 'var(--color-bg-surface)',
                border: '1px solid var(--color-border-default)',
                borderRadius: 'var(--radius-xs)',
                color: 'var(--color-text-primary)',
                fontFamily: 'var(--font-mono)',
                fontSize: 'var(--text-sm)',
              }}
            >
              {streams.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          ) : undefined
        }
      />

      {error && (
        <Card variant="outlined" padding="sm" style={{ borderColor: 'var(--color-error)', marginBottom: 'var(--spacing-4)' }}>
          <Text size="sm" color="var(--color-error)">{error}</Text>
        </Card>
      )}

      {streams.length === 0 && !loadingData ? (
        <Text color="tertiary">Потоков пока нет.</Text>
      ) : loadingData ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 'var(--spacing-8)' }}>
          <Spinner size="md" />
        </div>
      ) : lessons.length === 0 ? (
        <Text color="tertiary">В этом потоке пока нет доступных уроков.</Text>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-3)' }}>
          {lessons.map((lesson) => {
            const isClosed = lesson.status === 'closed';
            const isExpanded = expandedLessonId === lesson.id;

            return (
              <Card
                key={lesson.id}
                variant="default"
                padding="none"
                style={{ opacity: isClosed ? 0.5 : 1 }}
              >
                <div
                  onClick={() => !isClosed && setExpandedLessonId(isExpanded ? null : lesson.id)}
                  style={{
                    padding: 'var(--spacing-4) var(--spacing-5)',
                    cursor: isClosed ? 'default' : 'pointer',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--spacing-3)' }}>
                    <Heading level={3} size="md" style={{ margin: 0 }}>
                      {lesson.title}
                    </Heading>
                    {isClosed && (
                      <Badge variant="error">Недоступен</Badge>
                    )}
                  </div>
                  {!isClosed && (
                    <Mono size="xs" color="var(--color-text-tertiary)">
                      {isExpanded ? '▲' : '▼'}
                    </Mono>
                  )}
                </div>

                {isExpanded && !isClosed && (
                  <div style={{
                    padding: '0 var(--spacing-5) var(--spacing-5)',
                    borderTop: '1px solid var(--color-border-subtle)',
                  }}>
                    {lesson.videoUrl && (
                      <div style={{ marginTop: 'var(--spacing-4)', marginBottom: 'var(--spacing-4)' }}>
                        <a href={lesson.videoUrl} target="_blank" rel="noopener noreferrer" style={{ textDecoration: 'none' }}>
                          <Button variant="primary" size="sm">
                            Смотреть видео
                          </Button>
                        </a>
                      </div>
                    )}

                    {lesson.summary && (
                      <div style={{ marginTop: 'var(--spacing-3)' }}>
                        <Heading level={4} size="sm" style={{ marginBottom: 'var(--spacing-2)' }}>Описание</Heading>
                        <Text size="sm" color="secondary" style={{ whiteSpace: 'pre-wrap', lineHeight: 'var(--leading-relaxed)' }}>
                          {lesson.summary}
                        </Text>
                      </div>
                    )}

                    {lesson.notes && (
                      <div style={{ marginTop: 'var(--spacing-4)' }}>
                        <Heading level={4} size="sm" style={{ marginBottom: 'var(--spacing-2)' }}>Конспект</Heading>
                        <Card variant="elevated" padding="sm">
                          <Text size="sm" color="secondary" style={{ whiteSpace: 'pre-wrap', lineHeight: 'var(--leading-relaxed)' }}>
                            {lesson.notes}
                          </Text>
                        </Card>
                      </div>
                    )}

                    {!lesson.videoUrl && !lesson.summary && !lesson.notes && (
                      <Text size="sm" color="tertiary" style={{ marginTop: 'var(--spacing-3)', fontStyle: 'italic' }}>
                        Контент пока не добавлен.
                      </Text>
                    )}
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </>
  );
}

export default function StudentLessonsPage() {
  return (
    <Suspense fallback={
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh' }}>
        <Spinner size="lg" />
      </div>
    }>
      <StudentLessonsContent />
    </Suspense>
  );
}
