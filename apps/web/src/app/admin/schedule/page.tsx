'use client';

import { useEffect, useState, useCallback } from 'react';
import { useAuth } from '@/lib/auth-context';
import { PageHeader } from '@platform/ui/templates';
import { Button, Input, Heading, Spinner, Mono } from '@platform/ui/atoms';
import { Card, FormField, EmptyState } from '@platform/ui/molecules';
import {
  getStreams,
  getSchedule,
  createScheduleEntry,
  updateScheduleEntry,
  deleteScheduleEntry,
  type Stream,
  type ScheduleEntry,
} from '@/lib/api';

export default function SchedulePage() {
  const { user, accessToken } = useAuth();

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
    if (!accessToken || !user || user.role !== 'admin') return;
    getStreams(accessToken)
      .then((data) => {
        setStreams(data.streams);
        if (data.streams.length > 0 && !selectedStreamId) {
          setSelectedStreamId(data.streams[0]?.id ?? '');
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
      setNewDate(''); setNewStartTime(''); setNewLessonTitle(''); setNewNotes(''); setNewMeetingUrl('');
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

  const streamSelector = (
    <div className="flex items-center gap-3">
      <select
        value={selectedStreamId}
        onChange={(e) => setSelectedStreamId(e.target.value)}
        className="px-3 py-2 border border-[var(--color-border-default)] rounded-[var(--radius-xs)] text-sm font-mono bg-[var(--color-bg-surface)] text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-accent-red)]"
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
    <>
      <PageHeader
        title="Расписание"
        subtitle="Управление расписанием занятий"
        action={streamSelector}
      />

      {error && (
        <div className="px-4 py-3 mb-4 rounded-[var(--radius-xs)] border border-[var(--color-error)] bg-[var(--color-error-dim)] text-[var(--color-error)] text-sm">
          {error}
        </div>
      )}

      {showCreateForm && (
        <Card variant="elevated" padding="md" className="mb-6">
          <Heading level={3} size="md" className="mb-4">Новое занятие</Heading>
          <form onSubmit={handleCreate} className="flex flex-col gap-4">
            <div className="grid grid-cols-2 gap-4">
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
            <FormField id="new-notes" label="Тезисы" hint="Опционально, markdown">
              <textarea
                id="new-notes"
                value={newNotes}
                onChange={(e) => setNewNotes(e.target.value)}
                placeholder="Краткое описание того, что будет на занятии..."
                rows={3}
                className="w-full px-4 py-3 border border-[var(--color-border-default)] rounded-[var(--radius-xs)] text-sm bg-[var(--color-bg-surface)] text-[var(--color-text-primary)] resize-vertical focus:outline-none focus:border-[var(--color-accent-red)]"
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
            <div>
              <Button
                type="submit"
                variant="primary"
                size="sm"
                loading={creating}
                disabled={!newDate || !newStartTime || !newLessonTitle.trim()}
              >
                Создать
              </Button>
            </div>
          </form>
        </Card>
      )}

      {loadingEntries ? (
        <div className="flex justify-center py-8">
          <Spinner size="md" />
        </div>
      ) : !selectedStreamId ? (
        <EmptyState title="Выберите поток" description="Выберите поток для просмотра расписания." />
      ) : entries.length === 0 ? (
        <EmptyState
          title="Расписание пусто"
          description="Расписание пока пусто. Добавьте первое занятие."
          action={{ label: 'Добавить занятие', onClick: () => setShowCreateForm(true) }}
        />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-[var(--color-border-strong)]">
                {['Дата', 'Время', 'Урок', 'Тезисы', 'Созвон', 'Действия'].map((h) => (
                  <th key={h} className="px-3 py-2 text-left text-[var(--color-text-tertiary)] font-mono text-xs uppercase tracking-[var(--tracking-wider)]">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <tr key={entry.id} className="border-b border-[var(--color-border-subtle)] hover:bg-[var(--color-bg-surface)] transition-colors">
                  {editingId === entry.id ? (
                    <>
                      <td className="p-2"><Input type="date" value={editDate} onChange={(e) => setEditDate(e.target.value)} size="sm" /></td>
                      <td className="p-2"><Input type="time" value={editStartTime} onChange={(e) => setEditStartTime(e.target.value)} size="sm" /></td>
                      <td className="p-2"><Input type="text" value={editLessonTitle} onChange={(e) => setEditLessonTitle(e.target.value)} size="sm" /></td>
                      <td className="p-2">
                        <textarea
                          value={editNotes}
                          onChange={(e) => setEditNotes(e.target.value)}
                          rows={2}
                          className="w-full px-3 py-2 border border-[var(--color-border-default)] rounded-[var(--radius-xs)] text-sm bg-[var(--color-bg-surface)] text-[var(--color-text-primary)] resize-vertical focus:outline-none focus:border-[var(--color-accent-red)]"
                        />
                      </td>
                      <td className="p-2"><Input type="url" value={editMeetingUrl} onChange={(e) => setEditMeetingUrl(e.target.value)} size="sm" placeholder="https://..." /></td>
                      <td className="p-2">
                        <div className="flex items-center gap-2">
                          <Button variant="primary" size="sm" onClick={() => handleUpdate(entry.id)} loading={saving} disabled={!editLessonTitle.trim()}>Сохранить</Button>
                          <Button variant="ghost" size="sm" onClick={() => setEditingId(null)}>Отмена</Button>
                        </div>
                      </td>
                    </>
                  ) : (
                    <>
                      <td className="px-3 py-3 text-[var(--color-text-primary)] text-sm whitespace-nowrap">
                        {(() => {
                          const d = entry.date.slice(0, 10);
                          const [y, m, day] = d.split('-').map(Number);
                          return new Date(y!, (m ?? 1) - 1, day ?? 1).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' });
                        })()}
                      </td>
                      <td className="px-3 py-3">
                        <Mono size="xs" className="text-[var(--color-text-secondary)]">{entry.startTime}</Mono>
                      </td>
                      <td className="px-3 py-3 text-[var(--color-text-primary)] font-medium max-w-[200px]">{entry.lessonTitle}</td>
                      <td className="px-3 py-3 max-w-[160px] overflow-hidden text-ellipsis whitespace-nowrap">
                        <span className="text-[var(--color-text-tertiary)] text-xs">{entry.notes || '—'}</span>
                      </td>
                      <td className="px-3 py-3">
                        {entry.meetingUrl ? (
                          <a href={entry.meetingUrl} target="_blank" rel="noopener noreferrer" className="text-[var(--color-accent-red)] hover:text-[var(--color-text-primary)] text-xs transition-colors">
                            Ссылка
                          </a>
                        ) : (
                          <span className="text-[var(--color-text-tertiary)] text-xs">—</span>
                        )}
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex items-center gap-2">
                          <Button variant="secondary" size="sm" onClick={() => startEdit(entry)}>Редактировать</Button>
                          <Button variant="danger" size="sm" onClick={() => handleDelete(entry.id)}>Удалить</Button>
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
    </>
  );
}
