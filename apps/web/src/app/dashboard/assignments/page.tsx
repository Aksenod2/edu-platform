'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import {
  getStudentAssignments,
  updateStudentAssignment,
  getStreams,
  type StudentAssignment,
  type Stream,
} from '@/lib/api';

const statusLabels: Record<string, string> = {
  assigned: 'Назначено',
  submitted: 'Отправлено',
  reviewed: 'Проверено',
};

const statusColors: Record<string, { bg: string; color: string }> = {
  assigned: { bg: '#fff3cd', color: '#856404' },
  submitted: { bg: '#cce5ff', color: '#004085' },
  reviewed: { bg: '#e6f4ea', color: '#1a7f37' },
};

const typeLabels: Record<string, string> = {
  short: 'Короткое',
  long: 'Длинное',
};

export default function StudentAssignmentsPage() {
  const { user, accessToken, loading } = useAuth();
  const router = useRouter();

  const [assignments, setAssignments] = useState<StudentAssignment[]>([]);
  const [streams, setStreams] = useState<Stream[]>([]);
  const [loadingData, setLoadingData] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Filters
  const [streamFilter, setStreamFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  // Expanded assignment
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    if (!loading && !user) router.push('/login');
    if (!loading && user?.role === 'admin') router.push('/admin');
    if (!loading && user?.mustChangePassword) router.push('/change-password');
  }, [user, loading, router]);

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
    if (accessToken && user?.role === 'student') {
      fetchData();
    }
  }, [accessToken, user, fetchData]);

  const handleSubmit = async (saId: string) => {
    if (!accessToken) return;
    if (!confirm('Отправить задание на проверку?')) return;
    setError('');
    setSuccess('');
    try {
      await updateStudentAssignment(accessToken, saId, { status: 'submitted' });
      setSuccess('Задание отправлено на проверку');
      setTimeout(() => setSuccess(''), 3000);
      await fetchData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка отправки');
    }
  };

  if (loading) return <p style={{ padding: 32, fontFamily: 'sans-serif' }}>Загрузка...</p>;
  if (!user || user.role !== 'student') return null;

  return (
    <main style={{ padding: 32, fontFamily: 'sans-serif', maxWidth: 900, margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div>
          <button
            onClick={() => router.push('/dashboard')}
            style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 14, color: '#666', marginBottom: 8, display: 'block' }}
          >
            &larr; Назад
          </button>
          <h1 style={{ margin: 0 }}>Мои задания</h1>
        </div>
      </div>

      {error && (
        <div style={{ padding: 12, background: '#fee', border: '1px solid #fcc', borderRadius: 4, marginBottom: 16, color: '#c00', userSelect: 'text', cursor: 'text' }}>
          {error}
        </div>
      )}

      {success && (
        <div style={{ padding: 12, background: '#e6f4ea', border: '1px solid #a3d9a5', borderRadius: 4, marginBottom: 16, color: '#1a7f37' }}>
          {success}
        </div>
      )}

      {/* Filters */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
        <select
          value={streamFilter}
          onChange={(e) => setStreamFilter(e.target.value)}
          style={{ padding: '6px 12px', border: '1px solid #ccc', borderRadius: 4, fontSize: 14 }}
        >
          <option value="">Все потоки</option>
          {streams.map((s) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          style={{ padding: '6px 12px', border: '1px solid #ccc', borderRadius: 4, fontSize: 14 }}
        >
          <option value="">Все статусы</option>
          <option value="assigned">Назначено</option>
          <option value="submitted">Отправлено</option>
          <option value="reviewed">Проверено</option>
        </select>
      </div>

      {loadingData ? (
        <p>Загрузка заданий...</p>
      ) : assignments.length === 0 ? (
        <p style={{ color: '#666' }}>
          {statusFilter || streamFilter ? 'Нет заданий по выбранным фильтрам.' : 'У вас пока нет назначенных заданий.'}
        </p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {assignments.map((sa) => {
            const a = sa.assignment;
            const isExpanded = expandedId === sa.id;
            return (
              <div
                key={sa.id}
                style={{
                  border: '1px solid #eee',
                  borderRadius: 8,
                  overflow: 'hidden',
                  background: '#fff',
                }}
              >
                <div
                  onClick={() => setExpandedId(isExpanded ? null : sa.id)}
                  style={{
                    padding: '16px 20px',
                    cursor: 'pointer',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    background: isExpanded ? '#f9f9f9' : '#fff',
                  }}
                >
                  <div>
                    <div style={{ fontWeight: 500, fontSize: 16 }}>{a?.title}</div>
                    <div style={{ display: 'flex', gap: 8, marginTop: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                      <span style={{
                        padding: '1px 8px',
                        borderRadius: 10,
                        fontSize: 11,
                        fontWeight: 'bold',
                        background: statusColors[sa.status]?.bg,
                        color: statusColors[sa.status]?.color,
                      }}>
                        {statusLabels[sa.status]}
                      </span>
                      {a?.type && (
                        <span style={{ fontSize: 11, background: a.type === 'long' ? '#e8d5f5' : '#d5e8f5', padding: '1px 6px', borderRadius: 8 }}>
                          {typeLabels[a.type]}
                        </span>
                      )}
                      {a?.stream && (
                        <span style={{ fontSize: 12, color: '#666' }}>{a.stream.name}</span>
                      )}
                      {a?.lesson && (
                        <span style={{ fontSize: 12, color: '#999' }}>Урок: {a.lesson.title}</span>
                      )}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                    {a?.dueDate && (
                      <div style={{ fontSize: 13, color: new Date(a.dueDate) < new Date() ? '#c00' : '#666', textAlign: 'right' }}>
                        <div style={{ fontSize: 11, color: '#999' }}>Дедлайн</div>
                        {new Date(a.dueDate).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' })}
                      </div>
                    )}
                    <span style={{ fontSize: 18, color: '#999' }}>{isExpanded ? '▲' : '▼'}</span>
                  </div>
                </div>

                {isExpanded && (
                  <div style={{ padding: '0 20px 16px', borderTop: '1px solid #eee' }}>
                    {a?.description ? (
                      <div style={{ marginTop: 12 }}>
                        <strong style={{ fontSize: 13 }}>Описание:</strong>
                        <pre style={{ whiteSpace: 'pre-wrap', fontFamily: 'inherit', margin: '4px 0 0', fontSize: 14, lineHeight: 1.5 }}>
                          {a.description}
                        </pre>
                      </div>
                    ) : (
                      <p style={{ color: '#999', fontSize: 13, marginTop: 12 }}>Описание не указано.</p>
                    )}

                    {a?.tags && a.tags.length > 0 && (
                      <div style={{ marginTop: 8, display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                        {a.tags.map((tag) => (
                          <span key={tag} style={{ fontSize: 11, background: '#e8e8e8', padding: '1px 6px', borderRadius: 8 }}>{tag}</span>
                        ))}
                      </div>
                    )}

                    <div style={{ marginTop: 12, display: 'flex', gap: 12, alignItems: 'center', fontSize: 13, color: '#666' }}>
                      {sa.submittedAt && (
                        <span>Отправлено: {new Date(sa.submittedAt).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' })}</span>
                      )}
                      {sa.reviewedAt && (
                        <span>Проверено: {new Date(sa.reviewedAt).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' })}</span>
                      )}
                    </div>

                    {sa.status === 'assigned' && (
                      <div style={{ marginTop: 16 }}>
                        <button
                          onClick={() => handleSubmit(sa.id)}
                          style={{
                            padding: '8px 20px',
                            background: '#0070f3',
                            color: '#fff',
                            border: 'none',
                            borderRadius: 4,
                            cursor: 'pointer',
                            fontSize: 14,
                          }}
                        >
                          Отправить на проверку
                        </button>
                      </div>
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
