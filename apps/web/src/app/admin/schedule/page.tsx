'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { NotificationBell } from '@/lib/notification-bell';
import { DashboardLayout, PageHeader } from '@platform/ui/templates';
import { Card } from '@platform/ui/molecules';
import { FormField } from '@platform/ui/molecules';
import { EmptyState } from '@platform/ui/molecules';
import { Button } from '@platform/ui/atoms';
import { Input } from '@platform/ui/atoms';
import { Heading, Text } from '@platform/ui/atoms';
import { Spinner } from '@platform/ui/atoms';
import {
  getStreams,
  getSchedule,
  createScheduleEntry,
  updateScheduleEntry,
  deleteScheduleEntry,
  type Stream,
  type ScheduleEntry,
} from '@/lib/api';

const ADMIN_NAV = [
  {
    label: 'Управление',
    items: [
      { label: 'Обзор',      href: '/admin',           icon: <GridIcon /> },
      { label: 'Ученики',    href: '/admin/students',  icon: <UsersIcon /> },
      { label: 'Потоки',     href: '/admin/streams',   icon: <StreamIcon /> },
      { label: 'Расписание', href: '/admin/schedule',  icon: <CalendarIcon /> },
      { label: 'Уведомления', href: '/admin/notifications', icon: <BellNavIcon /> },
    ],
  },
];

export default function SchedulePage() {
  const { user, accessToken, loading, logout } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  const [streams, setStreams] = useState<Stream[]>([]);
  const [selectedStreamId, setSelectedStreamId] = useState<string>('');
  const [entries, setEntries] = useState<ScheduleEntry[]>([]);
  const [loadingEntries, setLoadingEntries] = useState(false);
  const [error, setError] = useState('');

  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newDate, setNewDate] = useState('');
  const [newStartTime, setNewStartTime] = useState('');
  const [newLessonTitle, setNewLessonTitle] = useState('');
  const [newNotes, setNewNotes] = useState('');
  const [newMeetingUrl, setNewMeetingUrl] = useState('');
  const [creating, setCreating] = useState(false);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDate, setEditDate] = useState('');
  const [editStartTime, setEditStartTime] = useState('');
  const [editLessonTitle, setEditLessonTitle] = useState('');
  const [editNotes, setEditNotes] = useState('');
  const [editMeetingUrl, setEditMeetingUrl] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!loading && !user) router.push('/login');
    if (!loading && user && user.role !== 'admin') router.push('/dashboard');
    if (!loading && user?.mustChangePassword) router.push('/change-password');
  }, [user, loading, router]);

  useEffect(() => {
    if (!accessToken || !user || user.role !== 'admin') return;
    getStreams(accessToken)
      .then((data) => {
        setStreams(data.streams);
        if (data.streams.length > 0 && !selectedStreamId) {
          setSelectedStreamId(data.streams[0].id);
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

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!accessToken || !selectedStreamId || !newDate || !newStartTime || !newLessonTitle.trim()) return;
    setCreating(true);
    setError('');
    try {
      await createScheduleEntry(accessToken, {
        streamId: selectedStreamId,
        date: newDate,
        startTime: newStartTime,
        lessonTitle: newLessonTitle.trim(),
        notes: newNotes.trim() || undefined,
        meetingUrl: newMeetingUrl.trim() || undefined,
      });
      setNewDate('');
      setNewStartTime('');
      setNewLessonTitle('');
      setNewNotes('');
      setNewMeetingUrl('');
      setShowCreateForm(false);
      await fetchSchedule();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка создания записи');
    } finally {
      setCreating(false);
    }
  };

  const startEdit = (entry: ScheduleEntry) => {
    setEditingId(entry.id);
    setEditDate(entry.date.slice(0, 10));
    setEditStartTime(entry.startTime);
    setEditLessonTitle(entry.lessonTitle);
    setEditNotes(entry.notes || '');
    setEditMeetingUrl(entry.meetingUrl || '');
  };

  const handleUpdate = async (id: string) => {
    if (!accessToken || !editLessonTitle.trim()) return;
    setSaving(true);
    setError('');
    try {
      await updateScheduleEntry(accessToken, id, {
        date: editDate,
        startTime: editStartTime,
        lessonTitle: editLessonTitle.trim(),
        notes: editNotes.trim() || null,
        meetingUrl: editMeetingUrl.trim() || null,
      });
      setEditingId(null);
      await fetchSchedule();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка обновления записи');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!accessToken) return;
    if (!confirm('Удалить запись из расписания?')) return;
    setError('');
    try {
      await deleteScheduleEntry(accessToken, id);
      await fetchSchedule();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка удаления записи');
    }
  };

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh' }}>
        <Spinner size="lg" />
      </div>
    );
  }

  if (!user || user.role !== 'admin') return null;

  const streamSelector = (
    <div style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'center' }}>
      <select
        value={selectedStreamId}
        onChange={(e) => setSelectedStreamId(e.target.value)}
        style={{
          padding: 'var(--space-2) var(--space-3)',
          border: '1px solid var(--color-border-default)',
          borderRadius: 'var(--radius-xs)',
          fontSize: 'var(--text-sm)',
          fontFamily: 'var(--font-mono)',
          background: 'var(--color-bg-surface)',
          color: 'var(--color-text-primary)',
        }}
      >
        {streams.length === 0 && <option value="">Нет потоков</option>}
        {streams.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name} {s.status === 'archived' ? '(архив)' : ''}
          </option>
        ))}
      </select>
      <Button
        variant={showCreateForm ? 'ghost' : 'primary'}
        size="sm"
        onClick={() => setShowCreateForm(!showCreateForm)}
        disabled={!selectedStreamId}
      >
        {showCreateForm ? 'Отмена' : 'Добавить занятие'}
      </Button>
    </div>
  );

  return (
    <DashboardLayout
      currentPath={pathname}
      header={{
        user: { name: user.name, role: 'admin' },
        onLogout: async () => { await logout(); router.push('/login'); },
        notificationBell: <NotificationBell />,
        platformName: 'PLATFORM ADMIN',
      }}
      sidebar={{ sections: ADMIN_NAV }}
    >
      <PageHeader
        title="Расписание"
        subtitle="Управление расписанием занятий"
        action={streamSelector}
      />

      {error && (
        <Card variant="outlined" padding="sm" style={{ borderColor: 'var(--color-error)', marginBottom: 'var(--space-4)' }}>
          <Text size="sm" color="var(--color-error)">{error}</Text>
        </Card>
      )}

      {showCreateForm && (
        <Card variant="elevated" padding="md" style={{ marginBottom: 'var(--space-6)' }}>
          <Heading level={3} size="md" style={{ marginBottom: 'var(--space-4)' }}>Новое занятие</Heading>
          <form onSubmit={handleCreate}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-4)', marginBottom: 'var(--space-4)' }}>
              <FormField
                id="new-date"
                label="Дата"
                required
                inputProps={{
                  type: 'date',
                  value: newDate,
                  onChange: (e: React.ChangeEvent<HTMLInputElement>) => setNewDate(e.target.value),
                  required: true,
                }}
              />
              <FormField
                id="new-time"
                label="Время начала"
                required
                inputProps={{
                  type: 'time',
                  value: newStartTime,
                  onChange: (e: React.ChangeEvent<HTMLInputElement>) => setNewStartTime(e.target.value),
                  required: true,
                }}
              />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)', marginBottom: 'var(--space-4)' }}>
              <FormField
                id="new-lesson-title"
                label="Название урока"
                required
                inputProps={{
                  type: 'text',
                  value: newLessonTitle,
                  onChange: (e: React.ChangeEvent<HTMLInputElement>) => setNewLessonTitle(e.target.value),
                  placeholder: 'Например: Основы типографики',
                  required: true,
                }}
              />
              <FormField
                id="new-notes"
                label="Тезисы"
                hint="Опционально, markdown"
              >
                <textarea
                  id="new-notes"
                  value={newNotes}
                  onChange={(e) => setNewNotes(e.target.value)}
                  placeholder="Краткое описание того, что будет на занятии..."
                  rows={3}
                  style={{
                    width: '100%',
                    padding: 'var(--space-3) var(--space-4)',
                    border: '1px solid var(--color-border-default)',
                    borderRadius: 'var(--radius-xs)',
                    fontFamily: 'var(--font-sans)',
                    fontSize: 'var(--text-base)',
                    color: 'var(--color-text-primary)',
                    background: 'var(--color-bg-surface)',
                    boxSizing: 'border-box',
                    resize: 'vertical',
                  }}
                />
              </FormField>
              <FormField
                id="new-meeting-url"
                label="Ссылка на созвон (Zoom, Meet, ...)"
                hint="Опционально"
                inputProps={{
                  type: 'url',
                  value: newMeetingUrl,
                  onChange: (e: React.ChangeEvent<HTMLInputElement>) => setNewMeetingUrl(e.target.value),
                  placeholder: 'https://zoom.us/j/...',
                }}
              />
            </div>
            <Button
              type="submit"
              variant="primary"
              size="sm"
              loading={creating}
              disabled={!newDate || !newStartTime || !newLessonTitle.trim()}
            >
              Создать
            </Button>
          </form>
        </Card>
      )}

      {loadingEntries ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 'var(--space-8)' }}>
          <Spinner size="md" />
        </div>
      ) : !selectedStreamId ? (
        <EmptyState
          title="Выберите поток"
          description="Выберите поток для просмотра расписания."
        />
      ) : entries.length === 0 ? (
        <EmptyState
          title="Расписание пусто"
          description="Расписание пока пусто. Добавьте первое занятие."
          action={{ label: 'Добавить занятие', onClick: () => setShowCreateForm(true) }}
        />
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{
            width: '100%',
            borderCollapse: 'collapse',
            fontFamily: 'var(--font-sans)',
            fontSize: 'var(--text-sm)',
          }}>
            <thead>
              <tr style={{ borderBottom: '2px solid var(--color-border-default)' }}>
                <th style={{ padding: 'var(--space-2) var(--space-3)', textAlign: 'left', color: 'var(--color-text-tertiary)', fontWeight: 500, fontSize: 'var(--text-xs)', textTransform: 'uppercase', letterSpacing: 'var(--tracking-wider)' }}>Дата</th>
                <th style={{ padding: 'var(--space-2) var(--space-3)', textAlign: 'left', color: 'var(--color-text-tertiary)', fontWeight: 500, fontSize: 'var(--text-xs)', textTransform: 'uppercase', letterSpacing: 'var(--tracking-wider)' }}>Время</th>
                <th style={{ padding: 'var(--space-2) var(--space-3)', textAlign: 'left', color: 'var(--color-text-tertiary)', fontWeight: 500, fontSize: 'var(--text-xs)', textTransform: 'uppercase', letterSpacing: 'var(--tracking-wider)' }}>Урок</th>
                <th style={{ padding: 'var(--space-2) var(--space-3)', textAlign: 'left', color: 'var(--color-text-tertiary)', fontWeight: 500, fontSize: 'var(--text-xs)', textTransform: 'uppercase', letterSpacing: 'var(--tracking-wider)' }}>Тезисы</th>
                <th style={{ padding: 'var(--space-2) var(--space-3)', textAlign: 'left', color: 'var(--color-text-tertiary)', fontWeight: 500, fontSize: 'var(--text-xs)', textTransform: 'uppercase', letterSpacing: 'var(--tracking-wider)' }}>Созвон</th>
                <th style={{ padding: 'var(--space-2) var(--space-3)', textAlign: 'right', color: 'var(--color-text-tertiary)', fontWeight: 500, fontSize: 'var(--text-xs)', textTransform: 'uppercase', letterSpacing: 'var(--tracking-wider)' }}>Действия</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <tr key={entry.id} style={{ borderBottom: '1px solid var(--color-border-subtle)' }}>
                  {editingId === entry.id ? (
                    <>
                      <td style={{ padding: 'var(--space-3)' }}>
                        <Input
                          type="date"
                          value={editDate}
                          onChange={(e) => setEditDate(e.target.value)}
                          size="sm"
                        />
                      </td>
                      <td style={{ padding: 'var(--space-3)' }}>
                        <Input
                          type="time"
                          value={editStartTime}
                          onChange={(e) => setEditStartTime(e.target.value)}
                          size="sm"
                        />
                      </td>
                      <td style={{ padding: 'var(--space-3)' }}>
                        <Input
                          type="text"
                          value={editLessonTitle}
                          onChange={(e) => setEditLessonTitle(e.target.value)}
                          size="sm"
                        />
                      </td>
                      <td style={{ padding: 'var(--space-3)' }}>
                        <textarea
                          value={editNotes}
                          onChange={(e) => setEditNotes(e.target.value)}
                          rows={2}
                          style={{
                            width: '100%',
                            padding: 'var(--space-2) var(--space-3)',
                            border: '1px solid var(--color-border-default)',
                            borderRadius: 'var(--radius-xs)',
                            fontFamily: 'var(--font-sans)',
                            fontSize: 'var(--text-sm)',
                            color: 'var(--color-text-primary)',
                            background: 'var(--color-bg-surface)',
                            boxSizing: 'border-box',
                            resize: 'vertical',
                          }}
                        />
                      </td>
                      <td style={{ padding: 'var(--space-3)' }}>
                        <Input
                          type="url"
                          value={editMeetingUrl}
                          onChange={(e) => setEditMeetingUrl(e.target.value)}
                          size="sm"
                          placeholder="https://zoom.us/j/..."
                        />
                      </td>
                      <td style={{ padding: 'var(--space-3)', textAlign: 'right' }}>
                        <div style={{ display: 'flex', gap: 'var(--space-2)', justifyContent: 'flex-end' }}>
                          <Button
                            variant="primary"
                            size="sm"
                            onClick={() => handleUpdate(entry.id)}
                            loading={saving}
                            disabled={!editLessonTitle.trim()}
                          >
                            Сохранить
                          </Button>
                          <Button variant="ghost" size="sm" onClick={() => setEditingId(null)}>
                            Отмена
                          </Button>
                        </div>
                      </td>
                    </>
                  ) : (
                    <>
                      <td style={{ padding: 'var(--space-3)' }}>
                        <Text size="sm" as="span">
                          {(() => {
                            const d = entry.date.slice(0, 10);
                            const [y, m, day] = d.split('-').map(Number);
                            return new Date(y, (m ?? 1) - 1, day ?? 1).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
                          })()}
                        </Text>
                      </td>
                      <td style={{ padding: 'var(--space-3)' }}>
                        <Text size="sm" as="span">{entry.startTime}</Text>
                      </td>
                      <td style={{ padding: 'var(--space-3)' }}>
                        <Text size="sm" weight="medium" as="span">{entry.lessonTitle}</Text>
                      </td>
                      <td style={{ padding: 'var(--space-3)', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        <Text size="xs" color="tertiary" as="span">{entry.notes || '—'}</Text>
                      </td>
                      <td style={{ padding: 'var(--space-3)', maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {entry.meetingUrl ? (
                          <a href={entry.meetingUrl} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--color-accent-blue, #2563eb)', fontSize: 'var(--text-xs)', textDecoration: 'underline' }}>
                            Ссылка
                          </a>
                        ) : (
                          <Text size="xs" color="tertiary" as="span">—</Text>
                        )}
                      </td>
                      <td style={{ padding: 'var(--space-3)', textAlign: 'right' }}>
                        <div style={{ display: 'flex', gap: 'var(--space-2)', justifyContent: 'flex-end' }}>
                          <Button variant="secondary" size="sm" onClick={() => startEdit(entry)}>
                            Редактировать
                          </Button>
                          <Button variant="danger" size="sm" onClick={() => handleDelete(entry.id)}>
                            Удалить
                          </Button>
                        </div>
                      </td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </DashboardLayout>
  );
}

// ─── Icons ──────────────────────────────────────────────

function GridIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="1" y="1" width="5" height="5" />
      <rect x="10" y="1" width="5" height="5" />
      <rect x="1" y="10" width="5" height="5" />
      <rect x="10" y="10" width="5" height="5" />
    </svg>
  );
}

function UsersIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <circle cx="6" cy="5" r="3" />
      <path d="M1 14c0-3 2-5 5-5s5 2 5 5" />
      <circle cx="12" cy="4" r="2" />
      <path d="M15 13c0-2-1-4-3-4" />
    </svg>
  );
}

function StreamIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M2 4h12M2 8h8M2 12h10" />
    </svg>
  );
}

function CalendarIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="1" y="3" width="14" height="12" />
      <path d="M1 7h14M5 1v4M11 1v4" />
    </svg>
  );
}

function BellNavIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M8 2.5a4.5 4.5 0 0 1 4.5 4.5c0 2.5 1 3.5 1 4H2.5s1-1.5 1-4A4.5 4.5 0 0 1 8 2.5z" />
      <path d="M6.5 13a1.5 1.5 0 0 0 3 0" />
      <path d="M8 2.5V1" />
    </svg>
  );
}
