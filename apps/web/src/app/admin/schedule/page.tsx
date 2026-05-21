'use client';

import { useEffect, useState, useCallback } from 'react';
import { useAuth } from '@/lib/auth-context';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, FieldLabel } from '@/components/ui/field';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
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
      <Select
        value={selectedStreamId}
        onValueChange={setSelectedStreamId}
        disabled={streams.length === 0}
      >
        <SelectTrigger className="w-full">
          <SelectValue placeholder="Нет потоков" />
        </SelectTrigger>
        <SelectContent>
          {streams.map((s) => (
            <SelectItem key={s.id} value={s.id}>
              {s.name} {s.status === 'archived' ? '(архив)' : ''}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button
        variant={showCreateForm ? 'ghost' : 'default'}
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
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Расписание</h1>
          <p className="text-sm text-muted-foreground">Управление расписанием занятий</p>
        </div>
        {streamSelector}
      </div>

      {error && (
        <Alert variant="destructive" className="mb-4">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {showCreateForm && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>Новое занятие</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleCreate} className="flex flex-col gap-4">
              <div className="grid grid-cols-2 gap-4">
                <Field>
                  <FieldLabel htmlFor="new-date">Дата</FieldLabel>
                  <Input
                    id="new-date"
                    type="date"
                    value={newDate}
                    onChange={(e) => setNewDate(e.target.value)}
                    required
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="new-time">Время начала</FieldLabel>
                  <Input
                    id="new-time"
                    type="time"
                    value={newStartTime}
                    onChange={(e) => setNewStartTime(e.target.value)}
                    required
                  />
                </Field>
              </div>
              <Field>
                <FieldLabel htmlFor="new-lesson-title">Название урока</FieldLabel>
                <Input
                  id="new-lesson-title"
                  type="text"
                  value={newLessonTitle}
                  onChange={(e) => setNewLessonTitle(e.target.value)}
                  placeholder="Например: Основы типографики"
                  required
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="new-notes">Тезисы</FieldLabel>
                <Textarea
                  id="new-notes"
                  value={newNotes}
                  onChange={(e) => setNewNotes(e.target.value)}
                  placeholder="Краткое описание того, что будет на занятии..."
                  rows={3}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="new-meeting-url">Ссылка на созвон (Zoom, Meet, ...)</FieldLabel>
                <Input
                  id="new-meeting-url"
                  type="url"
                  value={newMeetingUrl}
                  onChange={(e) => setNewMeetingUrl(e.target.value)}
                  placeholder="https://zoom.us/j/..."
                />
              </Field>
              <div>
                <Button
                  type="submit"
                  variant="default"
                  size="sm"
                  disabled={creating || !newDate || !newStartTime || !newLessonTitle.trim()}
                >
                  {creating && <Loader2 className="animate-spin" />}
                  Создать
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {loadingEntries ? (
        <div className="flex justify-center py-8">
          <Loader2 className="size-6 animate-spin text-muted-foreground" />
        </div>
      ) : !selectedStreamId ? (
        <div className="flex flex-col items-center justify-center gap-2 py-12 text-center text-muted-foreground">
          <p className="text-foreground font-medium">Выберите поток</p>
          <p>Выберите поток для просмотра расписания.</p>
        </div>
      ) : entries.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 py-12 text-center text-muted-foreground">
          <p className="text-foreground font-medium">Расписание пусто</p>
          <p>Расписание пока пусто. Добавьте первое занятие.</p>
          <Button variant="default" size="sm" onClick={() => setShowCreateForm(true)}>
            Добавить занятие
          </Button>
        </div>
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
                      <td className="p-2"><Input type="date" value={editDate} onChange={(e) => setEditDate(e.target.value)} /></td>
                      <td className="p-2"><Input type="time" value={editStartTime} onChange={(e) => setEditStartTime(e.target.value)} /></td>
                      <td className="p-2"><Input type="text" value={editLessonTitle} onChange={(e) => setEditLessonTitle(e.target.value)} /></td>
                      <td className="p-2">
                        <Textarea
                          value={editNotes}
                          onChange={(e) => setEditNotes(e.target.value)}
                          rows={2}
                        />
                      </td>
                      <td className="p-2"><Input type="url" value={editMeetingUrl} onChange={(e) => setEditMeetingUrl(e.target.value)} placeholder="https://..." /></td>
                      <td className="p-2">
                        <div className="flex items-center gap-2">
                          <Button variant="default" size="sm" onClick={() => handleUpdate(entry.id)} disabled={saving || !editLessonTitle.trim()}>{saving && <Loader2 className="animate-spin" />}Сохранить</Button>
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
                        <span className="font-mono text-xs text-muted-foreground">{entry.startTime}</span>
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
                          <Button variant="destructive" size="sm" onClick={() => handleDelete(entry.id)}>Удалить</Button>
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
