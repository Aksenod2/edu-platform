'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import {
  getStreams,
  getSchedule,
  type Stream,
  type ScheduleEntry,
} from '@/lib/api';

function isPast(dateStr: string, startTime: string): boolean {
  const entryDate = new Date(dateStr);
  const [hours, minutes] = startTime.split(':').map(Number);
  entryDate.setHours(hours || 0, minutes || 0, 0, 0);
  return entryDate < new Date();
}

export default function StudentSchedulePage() {
  const { user, accessToken, loading } = useAuth();
  const router = useRouter();

  const [streams, setStreams] = useState<Stream[]>([]);
  const [selectedStreamId, setSelectedStreamId] = useState<string>('');
  const [entries, setEntries] = useState<ScheduleEntry[]>([]);
  const [loadingEntries, setLoadingEntries] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!loading && !user) router.push('/login');
    if (!loading && user?.role === 'admin') router.push('/admin');
    if (!loading && user?.mustChangePassword) router.push('/change-password');
  }, [user, loading, router]);

  // Load streams (active only for students)
  useEffect(() => {
    if (!accessToken || !user) return;
    getStreams(accessToken)
      .then((data) => {
        const activeStreams = data.streams.filter((s) => s.status === 'active');
        setStreams(activeStreams);
        if (activeStreams.length > 0 && !selectedStreamId) {
          setSelectedStreamId(activeStreams[0].id);
        }
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Ошибка загрузки потоков'));
  }, [accessToken, user, selectedStreamId]);

  const fetchSchedule = useCallback(async () => {
    if (!accessToken || !selectedStreamId) return;
    setLoadingEntries(true);
    try {
      const data = await getSchedule(accessToken, selectedStreamId);
      setEntries(data.schedule);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка загрузки расписания');
    } finally {
      setLoadingEntries(false);
    }
  }, [accessToken, selectedStreamId]);

  useEffect(() => {
    if (selectedStreamId) fetchSchedule();
  }, [selectedStreamId, fetchSchedule]);

  if (loading) return <p style={{ padding: 32, fontFamily: 'sans-serif' }}>Загрузка...</p>;
  if (!user) return null;

  const upcomingEntries = entries.filter((e) => !isPast(e.date, e.startTime));
  const pastEntries = entries.filter((e) => isPast(e.date, e.startTime));

  return (
    <main style={{ padding: '24px 16px', fontFamily: 'sans-serif', maxWidth: 700, margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20, flexWrap: 'wrap', gap: 8 }}>
        <div>
          <button
            onClick={() => router.push('/dashboard')}
            style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 14, color: '#666', marginBottom: 4, display: 'block' }}
          >
            &larr; Назад
          </button>
          <h1 style={{ margin: 0, fontSize: 22 }}>Расписание</h1>
        </div>
        {streams.length > 1 && (
          <select
            value={selectedStreamId}
            onChange={(e) => setSelectedStreamId(e.target.value)}
            style={{ padding: '6px 12px', border: '1px solid #ccc', borderRadius: 4, fontSize: 14 }}
          >
            {streams.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        )}
      </div>

      {error && (
        <div style={{ padding: 12, background: '#fee', border: '1px solid #fcc', borderRadius: 4, marginBottom: 16, color: '#c00' }}>
          {error}
        </div>
      )}

      {loadingEntries ? (
        <p style={{ color: '#666' }}>Загрузка расписания...</p>
      ) : entries.length === 0 ? (
        <p style={{ color: '#666' }}>Расписание пока не заполнено.</p>
      ) : (
        <>
          {/* Upcoming */}
          {upcomingEntries.length > 0 && (
            <section style={{ marginBottom: 32 }}>
              <h2 style={{ fontSize: 16, color: '#0070f3', marginBottom: 12, textTransform: 'uppercase', letterSpacing: 1 }}>
                Предстоящие занятия
              </h2>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {upcomingEntries.map((entry) => (
                  <div
                    key={entry.id}
                    style={{
                      padding: 16,
                      background: '#f0f7ff',
                      border: '1px solid #d0e3ff',
                      borderRadius: 8,
                      borderLeft: '4px solid #0070f3',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: 4 }}>
                      <span style={{ fontWeight: 600, fontSize: 16 }}>{entry.lessonTitle}</span>
                      <span style={{ fontSize: 13, color: '#555', whiteSpace: 'nowrap' }}>
                        {new Date(entry.date).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })}, {entry.startTime}
                      </span>
                    </div>
                    {entry.notes && (
                      <p style={{ margin: '8px 0 0', fontSize: 14, color: '#444', lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>
                        {entry.notes}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Past */}
          {pastEntries.length > 0 && (
            <section>
              <h2 style={{ fontSize: 16, color: '#999', marginBottom: 12, textTransform: 'uppercase', letterSpacing: 1 }}>
                Прошедшие занятия
              </h2>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {pastEntries.map((entry) => (
                  <div
                    key={entry.id}
                    style={{
                      padding: 12,
                      background: '#fafafa',
                      border: '1px solid #eee',
                      borderRadius: 8,
                      borderLeft: '4px solid #ddd',
                      opacity: 0.7,
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: 4 }}>
                      <span style={{ fontWeight: 500, fontSize: 15 }}>{entry.lessonTitle}</span>
                      <span style={{ fontSize: 13, color: '#888', whiteSpace: 'nowrap' }}>
                        {new Date(entry.date).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })}, {entry.startTime}
                      </span>
                    </div>
                    {entry.notes && (
                      <p style={{ margin: '6px 0 0', fontSize: 13, color: '#777', lineHeight: 1.4, whiteSpace: 'pre-wrap' }}>
                        {entry.notes}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </main>
  );
}
