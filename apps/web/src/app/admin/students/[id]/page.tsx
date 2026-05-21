'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useParams } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

import {
  getProfile,
  addTeacherNote,
  getStudentAssignments,
  updateStudentAssignment,
  getAssignments,
  assignAssignment,
  getStudentAssignmentsSummary,
  getThread,
  addThreadEntry,
  uploadThreadFile,
  type ProfileResponse,
  type TeacherNote,
  type StudentAssignment,
  type Assignment,
  type AssignmentsSummary,
  type ThreadEntry,
  type ThreadEntryType,
} from '@/lib/api';

type Tab = 'profile' | 'assignments' | 'thread';

const STATUS_LABELS: Record<string, string> = {
  assigned: 'Выдано',
  submitted: 'Сдано',
  reviewed: 'Проверено',
  needs_revision: 'На доработке',
};

const STATUS_VARIANT: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  assigned: 'secondary',
  submitted: 'secondary',
  reviewed: 'default',
  needs_revision: 'secondary',
};

export default function StudentProfilePage() {
  const { accessToken } = useAuth();
  const params = useParams();
  const studentId = params.id as string;

  const [activeTab, setActiveTab] = useState<Tab>('profile');
  const [data, setData] = useState<ProfileResponse | null>(null);
  const [loadingProfile, setLoadingProfile] = useState(true);
  const [error, setError] = useState('');

  // Notes state
  const [noteContent, setNoteContent] = useState('');
  const [savingNote, setSavingNote] = useState(false);
  const [noteMessage, setNoteMessage] = useState('');

  // Assignments state
  const [assignments, setAssignments] = useState<StudentAssignment[]>([]);
  const [loadingAssignments, setLoadingAssignments] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [assignmentsSummary, setAssignmentsSummary] = useState<AssignmentsSummary | null>(null);
  const [loadingSummary, setLoadingSummary] = useState(false);

  // Assign modal state
  const [showAssignModal, setShowAssignModal] = useState(false);
  const [allAssignments, setAllAssignments] = useState<Assignment[]>([]);
  const [loadingAllAssignments, setLoadingAllAssignments] = useState(false);
  const [selectedAssignmentId, setSelectedAssignmentId] = useState('');
  const [assigning, setAssigning] = useState(false);
  const [assignSuccess, setAssignSuccess] = useState('');

  // Thread state
  const [threadEntries, setThreadEntries] = useState<ThreadEntry[]>([]);
  const [loadingThread, setLoadingThread] = useState(false);
  const [inputMode, setInputMode] = useState<'comment' | 'note'>('comment');
  const [threadContent, setThreadContent] = useState('');
  const [sendingThread, setSendingThread] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const fetchProfile = useCallback(async () => {
    if (!accessToken || !studentId) return;
    setLoadingProfile(true);
    try {
      const result = await getProfile(accessToken, studentId);
      setData(result);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка загрузки профиля');
    } finally {
      setLoadingProfile(false);
    }
  }, [accessToken, studentId]);

  const fetchAssignments = useCallback(async () => {
    if (!accessToken || !studentId) return;
    setLoadingAssignments(true);
    try {
      const result = await getStudentAssignments(accessToken, { studentId });
      setAssignments(result.studentAssignments);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка загрузки заданий');
    } finally {
      setLoadingAssignments(false);
    }
  }, [accessToken, studentId]);

  const fetchSummary = useCallback(async () => {
    if (!accessToken || !studentId) return;
    setLoadingSummary(true);
    try {
      const result = await getStudentAssignmentsSummary(accessToken, studentId);
      setAssignmentsSummary(result.summary);
    } catch {
      // summary не критична
    } finally {
      setLoadingSummary(false);
    }
  }, [accessToken, studentId]);

  const fetchThread = useCallback(async () => {
    if (!accessToken || !studentId) return;
    setLoadingThread(true);
    try {
      const result = await getThread(accessToken, studentId);
      setThreadEntries(result.entries);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка загрузки треда');
    } finally {
      setLoadingThread(false);
    }
  }, [accessToken, studentId]);

  useEffect(() => {
    if (accessToken && studentId) fetchProfile();
  }, [accessToken, studentId, fetchProfile]);

  useEffect(() => {
    if (accessToken && studentId && activeTab === 'assignments') {
      if (assignments.length === 0 && !loadingAssignments) fetchAssignments();
      if (!assignmentsSummary && !loadingSummary) fetchSummary();
    }
  }, [accessToken, studentId, activeTab, assignments.length, loadingAssignments, fetchAssignments, assignmentsSummary, loadingSummary, fetchSummary]);

  useEffect(() => {
    if (accessToken && studentId && activeTab === 'thread' && threadEntries.length === 0 && !loadingThread) {
      fetchThread();
    }
  }, [accessToken, studentId, activeTab, threadEntries.length, loadingThread, fetchThread]);

  useEffect(() => {
    if (activeTab === 'thread') {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [threadEntries, activeTab]);

  const handleAddNote = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!accessToken || !noteContent.trim()) return;
    setSavingNote(true);
    try {
      const { note } = await addTeacherNote(accessToken, studentId, noteContent.trim());
      setData((prev) => {
        if (!prev) return prev;
        return { ...prev, notes: [note, ...(prev.notes || [])] };
      });
      setNoteContent('');
      setNoteMessage('Заметка добавлена');
      setTimeout(() => setNoteMessage(''), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка добавления заметки');
    } finally {
      setSavingNote(false);
    }
  };

  const handleUpdateAssignment = async (saId: string, status: 'submitted' | 'reviewed' | 'needs_revision') => {
    if (!accessToken) return;
    setUpdatingId(saId);
    try {
      const { studentAssignment } = await updateStudentAssignment(accessToken, saId, { status });
      setAssignments((prev) => prev.map((a) => (a.id === saId ? studentAssignment : a)));
      fetchSummary();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка обновления статуса');
    } finally {
      setUpdatingId(null);
    }
  };

  const handleOpenAssignModal = async () => {
    setShowAssignModal(true);
    setSelectedAssignmentId('');
    setAssignSuccess('');
    if (allAssignments.length === 0) {
      setLoadingAllAssignments(true);
      try {
        const result = await getAssignments(accessToken!);
        setAllAssignments(result.assignments);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Ошибка загрузки заданий');
      } finally {
        setLoadingAllAssignments(false);
      }
    }
  };

  const handleAssignToStudent = async () => {
    if (!accessToken || !selectedAssignmentId) return;
    setAssigning(true);
    setError('');
    try {
      await assignAssignment(accessToken, selectedAssignmentId, { studentId });
      setAssignSuccess(`Задание назначено ${data?.student?.name || ''}`);
      setShowAssignModal(false);
      setSelectedAssignmentId('');
      await Promise.all([fetchAssignments(), fetchSummary()]);
      setTimeout(() => setAssignSuccess(''), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка назначения задания');
    } finally {
      setAssigning(false);
    }
  };

  const handleSendThread = async () => {
    if (!accessToken || !threadContent.trim()) return;
    setSendingThread(true);
    try {
      const { entry } = await addThreadEntry(accessToken, studentId, {
        type: inputMode as ThreadEntryType,
        content: threadContent.trim(),
      });
      setThreadEntries((prev) => [...prev, entry]);
      setThreadContent('');
      if (textareaRef.current) textareaRef.current.style.height = 'auto';
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка отправки');
    } finally {
      setSendingThread(false);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !accessToken) return;
    if (file.size > 50 * 1024 * 1024) {
      setError('Файл превышает максимальный размер 50MB');
      return;
    }
    setSendingThread(true);
    try {
      const { entry } = await uploadThreadFile(accessToken, studentId, file, 'file');
      setThreadEntries((prev) => [...prev, entry]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка загрузки файла');
    } finally {
      setSendingThread(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  if (loadingProfile) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="size-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="p-4">
        <a href="/admin/students" className="text-muted-foreground no-underline text-sm">← К списку учеников</a>
        <Alert variant="destructive" className="mt-4">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      </div>
    );
  }

  if (!data) return null;

  const { student, profile, notes } = data;

  const now = new Date();
  const filteredAssignments = statusFilter === 'all'
    ? assignments
    : statusFilter === 'overdue'
      ? assignments.filter((a) => {
          if (a.status === 'reviewed') return false;
          const dueDate = a.assignment?.dueDate;
          return dueDate && new Date(dueDate) < now;
        })
      : assignments.filter((a) => a.status === statusFilter);

  const hasThreadContent = threadContent.trim().length > 0;

  return (
    <>
      <div className="flex flex-col" style={{ height: 'calc(100vh - var(--header-height))' }}>

        {/* ── Header ── */}
        <div className="px-4 pt-4 max-w-[900px] w-full mx-auto">
          <a href="/admin/students" className="text-muted-foreground no-underline text-sm hover:text-foreground transition-colors">
            ← К списку учеников
          </a>

          <div className="flex items-start justify-between mt-2 mb-1 gap-3">
            <div className="min-w-0">
              <h1 className="m-0 mb-1 text-xl font-bold tracking-tight text-foreground">{student.name}</h1>
              <p className="text-muted-foreground m-0 text-sm">
                {student.email} · Зарегистрирован: {new Date(student.createdAt).toLocaleDateString('ru-RU')}
              </p>
            </div>
            <div className="flex items-center gap-3 shrink-0">
              {assignSuccess && (
                <span className="font-mono text-xs text-muted-foreground whitespace-nowrap">{assignSuccess}</span>
              )}
              <Button size="sm" onClick={handleOpenAssignModal}>
                + Назначить задание
              </Button>
            </div>
          </div>

          {/* Error banner */}
          {error && (
            <Alert variant="destructive" className="mt-3">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {/* Assign modal */}
          {showAssignModal && (
            <div className="mt-3 p-4 rounded-sm border bg-muted">
              <div className="flex justify-between items-center mb-3">
                <strong className="text-foreground text-sm">
                  Назначить задание ученику {student.name}
                </strong>
                <button
                  onClick={() => setShowAssignModal(false)}
                  className="bg-transparent border-0 cursor-pointer text-muted-foreground text-lg leading-none"
                >
                  ×
                </button>
              </div>
              {loadingAllAssignments ? (
                <div className="flex justify-center p-4"><Loader2 className="size-6 animate-spin text-muted-foreground" /></div>
              ) : allAssignments.length === 0 ? (
                <p className="text-muted-foreground text-sm">Нет доступных заданий. Создайте задание в разделе потока.</p>
              ) : (
                <>
                  <Select
                    value={selectedAssignmentId}
                    onValueChange={setSelectedAssignmentId}
                  >
                    <SelectTrigger className="w-full mb-3">
                      <SelectValue placeholder="Выберите задание..." />
                    </SelectTrigger>
                    <SelectContent>
                      {allAssignments.map((a) => (
                        <SelectItem key={a.id} value={a.id}>
                          {a.title} {a.stream ? `(${a.stream.name})` : ''} — {a.type === 'short' ? 'Короткое' : 'Длинное'}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      onClick={handleAssignToStudent}
                      disabled={!selectedAssignmentId || assigning}
                    >
                      {assigning && <Loader2 className="animate-spin" />}
                      Назначить
                    </Button>
                    <Button variant="secondary" size="sm" onClick={() => setShowAssignModal(false)}>
                      Отмена
                    </Button>
                  </div>
                </>
              )}
            </div>
          )}

          {/* Tabs */}
          <div className="flex gap-0 mt-4 border-b border-border-default">
            {([
              { key: 'profile' as Tab, label: 'Профиль' },
              { key: 'assignments' as Tab, label: 'Задания' },
              { key: 'thread' as Tab, label: 'Тред' },
            ]).map(({ key, label }) => (
              <button
                key={key}
                onClick={() => setActiveTab(key)}
                className={[
                  'px-4 py-2 border-0 bg-transparent cursor-pointer text-sm font-sans transition-colors',
                  activeTab === key
                    ? 'border-b-2 border-accent-red text-text-primary font-semibold'
                    : 'border-b-2 border-transparent text-text-tertiary hover:text-text-secondary',
                ].join(' ')}
                style={{ marginBottom: -1 }}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* ── Tab content ── */}
        <div className="flex-1 overflow-auto max-w-[900px] w-full mx-auto">

          {/* ── Profile tab ── */}
          {activeTab === 'profile' && (
            <div className="p-4">

              {/* Анкета */}
              <section>
                <h2 className="text-xl font-bold tracking-tight text-foreground mb-3">Анкета (Задание №0)</h2>
                {profile ? (
                  <div className="bg-muted border rounded-sm p-4">
                    <div className="mb-3">
                      <span className="block font-mono text-xs text-muted-foreground uppercase tracking-wider">Резюме</span>
                      <p className="mt-1 text-sm text-foreground whitespace-pre-wrap">{profile.resume || '—'}</p>
                    </div>
                    <div className="mb-3">
                      <span className="block font-mono text-xs text-muted-foreground uppercase tracking-wider">Портфолио</span>
                      <p className="mt-1 text-sm text-foreground">{profile.portfolio || '—'}</p>
                    </div>
                    <div className="mb-3">
                      <span className="block font-mono text-xs text-muted-foreground uppercase tracking-wider">Контакты</span>
                      <p className="mt-1 text-sm text-foreground">
                        {profile.contacts
                          ? `Email: ${(profile.contacts as { email?: string; telegram?: string }).email || '—'}, Telegram: ${(profile.contacts as { email?: string; telegram?: string }).telegram || '—'}`
                          : '—'}
                      </p>
                    </div>
                    <div className="mb-3">
                      <span className="block font-mono text-xs text-muted-foreground uppercase tracking-wider">Направление</span>
                      <p className="mt-1 text-sm text-foreground">{profile.direction || '—'}</p>
                    </div>
                    {profile.questionnaireCompletedAt ? (
                      <span className="block font-mono text-xs text-muted-foreground">
                        Заполнена: {new Date(profile.questionnaireCompletedAt).toLocaleDateString('ru-RU')}
                      </span>
                    ) : (
                      <span className="block font-mono text-xs text-destructive">Анкета не заполнена</span>
                    )}
                  </div>
                ) : (
                  <p className="text-muted-foreground text-sm">Ученик ещё не заполнил анкету.</p>
                )}
              </section>

              {/* Заметки преподавателя */}
              <section className="mt-8">
                <h2 className="text-xl font-bold tracking-tight text-foreground mb-3">Наблюдения преподавателя</h2>
                <form onSubmit={handleAddNote} className="mb-5">
                  <textarea
                    value={noteContent}
                    onChange={(e) => setNoteContent(e.target.value)}
                    placeholder="Добавить наблюдение или заметку..."
                    rows={3}
                    className="w-full px-3 py-2 mb-2 border rounded-xs bg-muted text-foreground text-sm font-sans resize-none"
                  />
                  <div className="flex items-center gap-3">
                    <Button type="submit" disabled={!noteContent.trim() || savingNote}>
                      {savingNote && <Loader2 className="animate-spin" />}
                      {savingNote ? 'Сохранение...' : 'Добавить заметку'}
                    </Button>
                    {noteMessage && (
                      <span className="font-mono text-xs text-muted-foreground">{noteMessage}</span>
                    )}
                  </div>
                </form>
                {notes && notes.length > 0 ? (
                  <div className="flex flex-col gap-3">
                    {notes.map((note: TeacherNote) => (
                      <div key={note.id} className="bg-muted border rounded-xs p-3">
                        <p className="m-0 text-sm text-foreground whitespace-pre-wrap">{note.content}</p>
                        <span className="block font-mono text-xs mt-2 text-muted-foreground">
                          {note.author.name} — {new Date(note.createdAt).toLocaleString('ru-RU')}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-muted-foreground text-sm">Заметок пока нет.</p>
                )}
              </section>
            </div>
          )}

          {/* ── Assignments tab ── */}
          {activeTab === 'assignments' && (
            <div className="p-4">
              {/* Summary block */}
              {(assignmentsSummary || loadingSummary) && (
                <div className="grid gap-3 mb-4 p-3 bg-bg-elevated border border-border-default rounded-sm [grid-template-columns:repeat(auto-fit,minmax(110px,1fr))]">
                  {loadingSummary && !assignmentsSummary ? (
                    <div className="col-span-full flex justify-center p-2">
                      <Loader2 className="size-4 animate-spin text-muted-foreground" />
                    </div>
                  ) : assignmentsSummary ? (
                    <>
                      <SummaryCard label="Выдано"      value={assignmentsSummary.total}          variant="info" />
                      <SummaryCard label="Сдано"        value={assignmentsSummary.submitted}       variant="warning" />
                      <SummaryCard label="Проверено"    value={assignmentsSummary.reviewed}        variant="success" />
                      <SummaryCard label="На доработке" value={assignmentsSummary.needs_revision}  variant="accent" />
                      <SummaryCard label="Просрочено"   value={assignmentsSummary.overdue}         variant="error" />
                    </>
                  ) : null}
                </div>
              )}

              {/* Status filter */}
              <div className="flex flex-wrap gap-2 mb-4">
                {[
                  { key: 'all',            label: 'Все' },
                  { key: 'assigned',       label: 'Выдано' },
                  { key: 'submitted',      label: 'Сдано' },
                  { key: 'reviewed',       label: 'Проверено' },
                  { key: 'needs_revision', label: 'На доработке' },
                  { key: 'overdue',        label: 'Просрочено' },
                ].map(({ key, label }) => (
                  <button
                    key={key}
                    onClick={() => setStatusFilter(key)}
                    className={[
                      'px-3 py-1 rounded-full text-sm font-sans cursor-pointer border transition-colors',
                      statusFilter === key
                        ? 'border-accent-red bg-accent-red-dim text-accent-red'
                        : 'border-border-default bg-transparent text-text-secondary hover:border-border-strong',
                    ].join(' ')}
                  >
                    {label}
                  </button>
                ))}
              </div>

              {loadingAssignments ? (
                <div className="flex justify-center p-8"><Loader2 className="size-8 animate-spin text-muted-foreground" /></div>
              ) : filteredAssignments.length === 0 ? (
                <p className="text-muted-foreground text-center py-8">
                  {assignments.length === 0 ? 'Заданий пока нет.' : 'Нет заданий с выбранным фильтром.'}
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-sm">
                    <thead>
                      <tr className="border-b-2">
                        {['Задание', 'Статус', 'Поток', 'Выдано', 'Срок сдачи', 'Действия'].map((h) => (
                          <th key={h} className="px-3 py-2 text-left font-mono text-xs uppercase tracking-wider text-muted-foreground">
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {filteredAssignments.map((sa) => {
                        const isOverdue = sa.status !== 'reviewed' && sa.assignment?.dueDate && new Date(sa.assignment.dueDate) < now;
                        return (
                          <tr key={sa.id} className="border-b hover:bg-muted transition-colors">
                            <td className="px-3 py-2.5 text-foreground">{sa.assignment?.title || '—'}</td>
                            <td className="px-3 py-2.5">
                              <span className="inline-flex items-center gap-1.5">
                                <Badge variant={STATUS_VARIANT[sa.status] || 'outline'}>
                                  {STATUS_LABELS[sa.status] || sa.status}
                                </Badge>
                                {isOverdue && <Badge variant="destructive">Просрочено</Badge>}
                              </span>
                            </td>
                            <td className="px-3 py-2.5 text-muted-foreground">{sa.assignment?.stream?.name || '—'}</td>
                            <td className="px-3 py-2.5">
                              <span className="font-mono text-xs text-muted-foreground">
                                {new Date(sa.createdAt).toLocaleDateString('ru-RU')}
                              </span>
                            </td>
                            <td className="px-3 py-2.5">
                              <span className="font-mono text-xs text-muted-foreground">
                                {sa.assignment?.dueDate
                                  ? new Date(sa.assignment.dueDate).toLocaleDateString('ru-RU')
                                  : '—'}
                              </span>
                            </td>
                            <td className="px-3 py-2.5">
                              {sa.status === 'submitted' && (
                                <div className="flex gap-1.5">
                                  <Button
                                    size="sm"
                                    onClick={() => handleUpdateAssignment(sa.id, 'reviewed')}
                                    disabled={updatingId === sa.id}
                                  >
                                    Принять
                                  </Button>
                                  <Button
                                    variant="secondary"
                                    size="sm"
                                    onClick={() => handleUpdateAssignment(sa.id, 'needs_revision')}
                                    disabled={updatingId === sa.id}
                                  >
                                    На доработку
                                  </Button>
                                </div>
                              )}
                              {sa.status === 'assigned' && (
                                <span className="font-mono text-xs text-muted-foreground">—</span>
                              )}
                              {sa.status === 'needs_revision' && (
                                <span className="font-mono text-xs text-muted-foreground">↩ Ожидает пересдачи</span>
                              )}
                              {sa.status === 'reviewed' && (
                                <span className="font-mono text-xs text-muted-foreground">✓ Проверено</span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* ── Thread tab ── */}
          {activeTab === 'thread' && (
            <div className="flex flex-col flex-1 min-h-0">
              {/* Thread messages */}
              <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-2">
                {loadingThread ? (
                  <div className="flex-1 flex items-center justify-center">
                    <Loader2 className="size-8 animate-spin text-muted-foreground" />
                  </div>
                ) : threadEntries.length === 0 ? (
                  <div className="flex-1 flex items-center justify-center">
                    <span className="font-mono text-sm text-muted-foreground uppercase tracking-wide">Тред пуст</span>
                  </div>
                ) : (
                  threadEntries.map((entry, i) => (
                    <ThreadBubble
                      key={entry.id}
                      entry={entry}
                      showAuthor={i === 0 || threadEntries[i - 1].authorId !== entry.authorId}
                    />
                  ))
                )}
                <div ref={bottomRef} />
              </div>

              {/* Compose bar */}
              <div className="border-t border-border-subtle px-4 py-3 bg-bg-surface">
                {inputMode === 'note' && (
                  <div className="flex items-center justify-between px-3 py-2 mb-2 bg-warning-dim border border-warning rounded-sm">
                    <span className="font-mono text-xs text-warning uppercase tracking-wide">
                      Приватная заметка — ученик не увидит
                    </span>
                    <button
                      onClick={() => setInputMode('comment')}
                      className="bg-transparent border-0 cursor-pointer text-warning p-1 flex"
                    >
                      ×
                    </button>
                  </div>
                )}

                <div className="flex items-end gap-2">
                  <div className="flex gap-1">
                    <input ref={fileInputRef} type="file" onChange={handleFileUpload} className="hidden" />
                    <ComposeButton title="Прикрепить файл" onClick={() => fileInputRef.current?.click()} disabled={sendingThread}>
                      <PaperclipIcon />
                    </ComposeButton>
                    <ComposeButton
                      title="Приватная заметка"
                      active={inputMode === 'note'}
                      onClick={() => setInputMode(inputMode === 'note' ? 'comment' : 'note')}
                    >
                      <NoteIcon />
                    </ComposeButton>
                  </div>
                  <textarea
                    ref={textareaRef}
                    value={threadContent}
                    onChange={(e) => {
                      setThreadContent(e.target.value);
                      e.target.style.height = 'auto';
                      e.target.style.height = Math.min(e.target.scrollHeight, 160) + 'px';
                    }}
                    placeholder={inputMode === 'comment' ? 'Комментарий для ученика...' : 'Приватная заметка...'}
                    rows={1}
                    className="flex-1 px-3 py-2 text-sm font-sans text-text-primary resize-none overflow-hidden leading-normal"
                    style={{
                      borderRadius: 'var(--radius-lg)',
                      border: `1px solid ${inputMode === 'note' ? 'var(--color-warning)' : 'var(--color-border-default)'}`,
                      background: inputMode === 'note' ? 'var(--color-warning-dim)' : 'var(--color-bg-elevated)',
                      minHeight: 36, maxHeight: 160, outline: 'none',
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSendThread(); }
                    }}
                  />
                  <button
                    disabled={sendingThread || !hasThreadContent}
                    onClick={handleSendThread}
                    className="flex items-center justify-center shrink-0 border-0 transition-colors"
                    style={{
                      width: 36, height: 36, borderRadius: 'var(--radius-full)',
                      background: hasThreadContent ? 'var(--color-accent-red)' : 'var(--color-bg-elevated)',
                      color: hasThreadContent ? 'var(--color-text-primary)' : 'var(--color-text-disabled)',
                      cursor: hasThreadContent ? 'pointer' : 'default',
                    }}
                  >
                    <SendIcon />
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

/* ─── SummaryCard ─── */

function SummaryCard({ label, value, variant }: {
  label: string; value: number;
  variant: 'info' | 'warning' | 'success' | 'error' | 'accent' | 'default';
}) {
  const colorMap = {
    info:    { text: 'text-info',    bg: 'bg-info-dim',    border: 'border-info' },
    warning: { text: 'text-warning', bg: 'bg-warning-dim', border: 'border-warning' },
    success: { text: 'text-success', bg: 'bg-success-dim', border: 'border-success' },
    error:   { text: 'text-error',   bg: 'bg-error-dim',   border: 'border-error' },
    accent:  { text: 'text-accent-red', bg: 'bg-accent-red-dim', border: 'border-accent-red' },
    default: { text: 'text-text-secondary', bg: 'bg-bg-elevated', border: 'border-border-default' },
  };
  const c = colorMap[variant];
  return (
    <div className={`flex flex-col items-center justify-center gap-1 p-3 rounded-sm border ${c.bg} ${c.border} min-w-[90px]`}>
      <span className={`text-2xl font-bold leading-none ${c.text}`}>{value}</span>
      <span className={`text-xs text-center leading-tight ${c.text} opacity-80`}>{label}</span>
    </div>
  );
}

/* ─── ComposeButton ─── */

function ComposeButton({ children, title, onClick, disabled, active }: {
  children: React.ReactNode; title: string; onClick: () => void; disabled?: boolean; active?: boolean;
}) {
  return (
    <button
      title={title}
      onClick={onClick}
      disabled={disabled}
      className={[
        'flex items-center justify-center shrink-0 border-0 transition-colors',
        active ? 'bg-bg-overlay text-text-primary' : 'bg-transparent text-text-tertiary',
        disabled ? 'opacity-40 cursor-default' : 'cursor-pointer hover:text-text-secondary',
      ].join(' ')}
      style={{ width: 36, height: 36, borderRadius: 'var(--radius-full)' }}
    >
      {children}
    </button>
  );
}

/* ─── ThreadBubble ─── */

function ThreadBubble({ entry, showAuthor }: { entry: ThreadEntry; showAuthor: boolean }) {
  const isAdmin = entry.author.role === 'admin';
  const isNote = entry.type === 'note';
  const date = new Date(entry.createdAt);
  const initials = entry.author.name.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase();

  return (
    <div className={[
      'flex items-end gap-2',
      isAdmin ? 'flex-row-reverse self-end' : 'flex-row self-start',
      showAuthor ? 'mt-4' : 'mt-1',
      'max-w-[85%]',
    ].join(' ')}>
      {showAuthor ? (
        <div
          className={[
            'w-8 h-8 rounded-full flex items-center justify-center shrink-0',
            'text-xs font-mono font-bold',
            isNote ? 'bg-warning-dim border border-warning text-warning'
              : isAdmin ? 'bg-accent-red-dim border border-accent-red text-accent-red'
              : 'bg-bg-overlay border border-border-default text-text-secondary',
          ].join(' ')}
        >
          {initials}
        </div>
      ) : (
        <div className="w-8 shrink-0" />
      )}
      <div className="min-w-0">
        {showAuthor && (
          <div className={[
            'text-xs font-mono mb-1 tracking-wide uppercase',
            isNote ? 'text-warning' : isAdmin ? 'text-accent-red' : 'text-text-tertiary',
            isAdmin ? 'text-right' : 'text-left',
          ].join(' ')}>
            {entry.author.name}
            {isNote && <span className="ml-2 text-warning">заметка</span>}
          </div>
        )}
        <div style={{
          padding: 'var(--spacing-3) var(--spacing-4)',
          borderRadius: isAdmin
            ? 'var(--radius-xl) var(--radius-xl) var(--radius-xs) var(--radius-xl)'
            : 'var(--radius-xl) var(--radius-xl) var(--radius-xl) var(--radius-xs)',
          background: isNote ? 'var(--color-warning-dim)' : isAdmin ? 'var(--color-bg-overlay)' : 'var(--color-bg-elevated)',
          border: `1px solid ${isNote ? 'var(--color-warning)' : 'var(--color-border-default)'}`,
          borderStyle: isNote ? 'dashed' : 'solid',
        }}>
          <div className="text-sm leading-normal text-text-primary break-words">
            {['text', 'comment', 'note'].includes(entry.type) ? (
              <span className="whitespace-pre-wrap">{entry.content}</span>
            ) : entry.type === 'file' ? (
              <div className="flex items-center gap-3">
                <span>{entry.metadata?.fileName || entry.content}</span>
                {entry.metadata?.url && (
                  <a href={entry.metadata.url} target="_blank" rel="noopener noreferrer" className="text-info text-xs">
                    Скачать
                  </a>
                )}
              </div>
            ) : entry.type === 'audio' && entry.metadata?.url ? (
              <audio controls src={entry.metadata.url} className="max-w-full h-9" />
            ) : entry.type === 'link' ? (
              <a href={entry.content} target="_blank" rel="noopener noreferrer" className="text-info break-all">
                {entry.content}
              </a>
            ) : null}
          </div>
          <div className={`text-[10px] text-text-disabled mt-1 font-mono ${isAdmin ? 'text-left' : 'text-right'}`}>
            {date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}
          </div>
        </div>
        {entry.assignment && (
          <span className="block font-mono text-xs mt-1 text-muted-foreground">
            К заданию: {entry.assignment.title}
          </span>
        )}
      </div>
    </div>
  );
}

/* ─── SVG Icons ─── */

function PaperclipIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17.5 9.25l-7.72 7.72a4.25 4.25 0 01-6.01-6.01L11.5 3.24a2.83 2.83 0 014 4L7.78 14.96a1.42 1.42 0 01-2-2l7.22-7.22" />
    </svg>
  );
}

function NoteIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 3h12v14H4z" /><path d="M7 7h6M7 10h6M7 13h3" />
    </svg>
  );
}

function SendIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
      <path d="M3 10l14-7-7 14v-7H3z" fill="currentColor" />
    </svg>
  );
}
