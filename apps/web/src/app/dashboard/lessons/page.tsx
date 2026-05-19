'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import {
  getStreams,
  getLessons,
  type Stream,
  type Lesson,
} from '@/lib/api';

export default function StudentLessonsPage() {
  const { user, accessToken, loading } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const streamIdParam = searchParams.get('streamId');

  const [streams, setStreams] = useState<Stream[]>([]);
  const [selectedStreamId, setSelectedStreamId] = useState<string | null>(streamIdParam);
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [loadingData, setLoadingData] = useState(true);
  const [expandedLessonId, setExpandedLessonId] = useState<string | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!loading && !user) router.push('/login');
    if (!loading && user?.role === 'admin') router.push('/admin');
    if (!loading && user?.mustChangePassword) router.push('/change-password');
  }, [user, loading, router]);

  const fetchStreams = useCallback(async () => {
    if (!accessToken) return;
    try {
      const data = await getStreams(accessToken);
      setStreams(data.streams);
      // Auto-select first stream if none selected
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

  if (loading) return <p style={{ padding: 32, fontFamily: 'sans-serif' }}>Загрузка...</p>;
  if (!user || user.role !== 'student') return null;

  return (
    <main style={{ padding: 32, fontFamily: 'sans-serif', maxWidth: 900, margin: '0 auto' }}>
      <div style={{ marginBottom: 24 }}>
        <button
          onClick={() => router.push('/dashboard')}
          style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 14, color: '#666', marginBottom: 8, display: 'block' }}
        >
          &larr; Назад
        </button>
        <h1 style={{ margin: 0 }}>Уроки</h1>
      </div>

      {error && (
        <div style={{ padding: 12, background: '#fee', border: '1px solid #fcc', borderRadius: 4, marginBottom: 16, color: '#c00' }}>
          {error}
        </div>
      )}

      {streams.length > 1 && (
        <div style={{ marginBottom: 24 }}>
          <label style={{ fontWeight: 'bold', fontSize: 14, marginRight: 8 }}>Поток:</label>
          <select
            value={selectedStreamId || ''}
            onChange={(e) => {
              setSelectedStreamId(e.target.value);
              setExpandedLessonId(null);
            }}
            style={{ padding: '6px 12px', border: '1px solid #ccc', borderRadius: 4, fontSize: 14 }}
          >
            {streams.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </div>
      )}

      {streams.length === 0 && !loadingData ? (
        <p style={{ color: '#666' }}>Потоков пока нет.</p>
      ) : loadingData ? (
        <p>Загрузка уроков...</p>
      ) : lessons.length === 0 ? (
        <p style={{ color: '#666' }}>В этом потоке пока нет доступных уроков.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {lessons.map((lesson) => {
            const isClosed = lesson.status === 'closed';
            const isExpanded = expandedLessonId === lesson.id;

            return (
              <div
                key={lesson.id}
                style={{
                  border: '1px solid #eee',
                  borderRadius: 8,
                  overflow: 'hidden',
                  opacity: isClosed ? 0.6 : 1,
                }}
              >
                <div
                  onClick={() => !isClosed && setExpandedLessonId(isExpanded ? null : lesson.id)}
                  style={{
                    padding: '16px 20px',
                    background: isClosed ? '#f9f9f9' : '#fff',
                    cursor: isClosed ? 'default' : 'pointer',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                  }}
                >
                  <div>
                    <h3 style={{ margin: 0, fontSize: 16 }}>
                      {lesson.title}
                    </h3>
                    {isClosed && (
                      <span style={{ fontSize: 12, color: '#9a3030', fontWeight: 'bold' }}>
                        Ещё не доступен
                      </span>
                    )}
                  </div>
                  {!isClosed && (
                    <span style={{ color: '#666', fontSize: 18 }}>
                      {isExpanded ? '\u25B2' : '\u25BC'}
                    </span>
                  )}
                </div>

                {isExpanded && !isClosed && (
                  <div style={{ padding: '0 20px 20px', borderTop: '1px solid #eee' }}>
                    {lesson.videoUrl && (
                      <div style={{ marginTop: 16, marginBottom: 16 }}>
                        <a
                          href={lesson.videoUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{
                            display: 'inline-block',
                            padding: '10px 20px',
                            background: '#0070f3',
                            color: '#fff',
                            borderRadius: 4,
                            textDecoration: 'none',
                            fontSize: 14,
                          }}
                        >
                          Смотреть видео
                        </a>
                      </div>
                    )}

                    {lesson.summary && (
                      <div style={{ marginTop: 12 }}>
                        <h4 style={{ margin: '0 0 8px', fontSize: 14, color: '#333' }}>Описание</h4>
                        <div style={{ whiteSpace: 'pre-wrap', fontSize: 14, lineHeight: 1.6, color: '#444' }}>
                          {lesson.summary}
                        </div>
                      </div>
                    )}

                    {lesson.notes && (
                      <div style={{ marginTop: 16 }}>
                        <h4 style={{ margin: '0 0 8px', fontSize: 14, color: '#333' }}>Конспект</h4>
                        <div
                          style={{
                            whiteSpace: 'pre-wrap',
                            fontSize: 14,
                            lineHeight: 1.6,
                            color: '#444',
                            padding: 16,
                            background: '#f9f9f9',
                            borderRadius: 4,
                            border: '1px solid #eee',
                          }}
                        >
                          {lesson.notes}
                        </div>
                      </div>
                    )}

                    {!lesson.videoUrl && !lesson.summary && !lesson.notes && (
                      <p style={{ marginTop: 12, color: '#666', fontStyle: 'italic' }}>
                        Контент пока не добавлен.
                      </p>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </main>
  );
}
