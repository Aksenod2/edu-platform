'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useParams } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Card, CardContent } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
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

  // Assignments state
  const [assignments, setAssignments] = useState<StudentAssignment[]>([]);
  const [loadingAssignments, setLoadingAssignments] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [assignmentsSummary, setAssignmentsSummary] = useState<AssignmentsSummary | null>(null);
  const [loadingSummary, setLoadingSummary] = useState(false);
  const [pendingRevision, setPendingRevision] = useState<StudentAssignment | null>(null);

  // Assign modal state
  const [showAssignModal, setShowAssignModal] = useState(false);
  const [allAssignments, setAllAssignments] = useState<Assignment[]>([]);
  const [loadingAllAssignments, setLoadingAllAssignments] = useState(false);
  const [selectedAssignmentId, setSelectedAssignmentId] = useState('');
  const [assigning, setAssigning] = useState(false);

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
      toast.error(err instanceof Error ? err.message : 'Ошибка загрузки заданий');
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
      toast.error(err instanceof Error ? err.message : 'Ошибка загрузки треда');
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
      toast.success('Заметка добавлена');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Ошибка добавления заметки');
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
      toast.success('Статус обновлён');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Ошибка обновления статуса');
    } finally {
      setUpdatingId(null);
    }
  };

  const handleOpenAssignModal = async () => {
    setShowAssignModal(true);
    setSelectedAssignmentId('');
    if (allAssignments.length === 0) {
      setLoadingAllAssignments(true);
      try {
        const result = await getAssignments(accessToken!);
        setAllAssignments(result.assignments);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Ошибка загрузки заданий');
      } finally {
        setLoadingAllAssignments(false);
      }
    }
  };

  const handleAssignToStudent = async () => {
    if (!accessToken || !selectedAssignmentId) return;
    setAssigning(true);
    try {
      await assignAssignment(accessToken, selectedAssignmentId, { studentId });
      toast.success(`Задание назначено ${data?.student?.name || ''}`);
      setShowAssignModal(false);
      setSelectedAssignmentId('');
      await Promise.all([fetchAssignments(), fetchSummary()]);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Ошибка назначения задания');
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
      toast.error(err instanceof Error ? err.message : 'Ошибка отправки');
    } finally {
      setSendingThread(false);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !accessToken) return;
    if (file.size > 50 * 1024 * 1024) {
      toast.error('Файл превышает максимальный размер 50MB');
      return;
    }
    setSendingThread(true);
    try {
      const { entry } = await uploadThreadFile(accessToken, studentId, file, 'file');
      setThreadEntries((prev) => [...prev, entry]);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Ошибка загрузки файла');
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
              <Button size="sm" onClick={handleOpenAssignModal}>
                + Назначить задание
              </Button>
            </div>
          </div>

          {/* Assign modal */}
          {showAssignModal && (
            <div className="mt-3 p-4 rounded-sm border bg-muted">
              <div className="flex justify-between items-center mb-3">
                <strong className="text-foreground text-sm">
                  Назначить задание ученику {student.name}
                </strong>
                <button
                  onClick={() => setShowAssignModal(false)}
                  className="bg-transparent border-0 cursor-pointer text-muted-foreground hover:text-foreground text-lg leading-none"
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
          <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as Tab)} className="mt-4">
            <TabsList>
              <TabsTrigger value="profile">Профиль</TabsTrigger>
              <TabsTrigger value="assignments">Задания</TabsTrigger>
              <TabsTrigger value="thread">Тред</TabsTrigger>
            </TabsList>
          </Tabs>
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
                  <Card>
                    <CardContent className="space-y-3">
                    <div>
                      <span className="block font-mono text-xs text-muted-foreground uppercase tracking-wider">Резюме</span>
                      <p className="mt-1 text-sm text-foreground whitespace-pre-wrap">{profile.resume || '—'}</p>
                    </div>
                    <div>
                      <span className="block font-mono text-xs text-muted-foreground uppercase tracking-wider">Портфолио</span>
                      <p className="mt-1 text-sm text-foreground">{profile.portfolio || '—'}</p>
                    </div>
                    <div>
                      <span className="block font-mono text-xs text-muted-foreground uppercase tracking-wider">Контакты</span>
                      <p className="mt-1 text-sm text-foreground">
                        {profile.contacts
                          ? `Email: ${(profile.contacts as { email?: string; telegram?: string }).email || '—'}, Telegram: ${(profile.contacts as { email?: string; telegram?: string }).telegram || '—'}`
                          : '—'}
                      </p>
                    </div>
                    <div>
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
                    </CardContent>
                  </Card>
                ) : (
                  <p className="text-muted-foreground text-sm">Ученик ещё не заполнил анкету.</p>
                )}
              </section>

              {/* Заметки преподавателя */}
              <section className="mt-8">
                <h2 className="text-xl font-bold tracking-tight text-foreground mb-3">Наблюдения преподавателя</h2>
                <form onSubmit={handleAddNote} className="mb-5">
                  <Textarea
                    value={noteContent}
                    onChange={(e) => setNoteContent(e.target.value)}
                    placeholder="Добавить наблюдение или заметку..."
                    rows={3}
                    className="mb-2 resize-none"
                  />
                  <Button type="submit" disabled={!noteContent.trim() || savingNote}>
                    {savingNote && <Loader2 className="animate-spin" />}
                    {savingNote ? 'Сохранение...' : 'Добавить заметку'}
                  </Button>
                </form>
                {notes && notes.length > 0 ? (
                  <div className="flex flex-col gap-3">
                    {notes.map((note: TeacherNote) => (
                      <Card key={note.id}>
                        <CardContent>
                          <p className="m-0 text-sm text-foreground whitespace-pre-wrap">{note.content}</p>
                          <span className="block font-mono text-xs mt-2 text-muted-foreground">
                            {note.author.name} — {new Date(note.createdAt).toLocaleString('ru-RU')}
                          </span>
                        </CardContent>
                      </Card>
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
                <div className="grid gap-3 mb-4 p-3 bg-muted border rounded-lg [grid-template-columns:repeat(auto-fit,minmax(110px,1fr))]">
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
                      'px-3 py-1 rounded-full text-sm cursor-pointer border transition-colors',
                      statusFilter === key
                        ? 'border-primary bg-primary text-primary-foreground'
                        : 'border bg-transparent text-muted-foreground hover:text-foreground',
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
                <div className="rounded-lg border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        {['Задание', 'Статус', 'Поток', 'Выдано', 'Срок сдачи', 'Действия'].map((h) => (
                          <TableHead key={h}>{h}</TableHead>
                        ))}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredAssignments.map((sa) => {
                        const isOverdue = sa.status !== 'reviewed' && sa.assignment?.dueDate && new Date(sa.assignment.dueDate) < now;
                        return (
                          <TableRow key={sa.id}>
                            <TableCell className="text-foreground">{sa.assignment?.title || '—'}</TableCell>
                            <TableCell>
                              <span className="inline-flex items-center gap-1.5">
                                <Badge variant={STATUS_VARIANT[sa.status] || 'outline'}>
                                  {STATUS_LABELS[sa.status] || sa.status}
                                </Badge>
                                {isOverdue && <Badge variant="destructive">Просрочено</Badge>}
                              </span>
                            </TableCell>
                            <TableCell className="text-muted-foreground">{sa.assignment?.stream?.name || '—'}</TableCell>
                            <TableCell>
                              <span className="font-mono text-xs text-muted-foreground">
                                {new Date(sa.createdAt).toLocaleDateString('ru-RU')}
                              </span>
                            </TableCell>
                            <TableCell>
                              <span className="font-mono text-xs text-muted-foreground">
                                {sa.assignment?.dueDate
                                  ? new Date(sa.assignment.dueDate).toLocaleDateString('ru-RU')
                                  : '—'}
                              </span>
                            </TableCell>
                            <TableCell>
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
                                    onClick={() => setPendingRevision(sa)}
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
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
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
              <div className="border-t px-4 py-3 bg-card">
                {inputMode === 'note' && (
                  <div className="flex items-center justify-between px-3 py-2 mb-2 bg-muted border rounded-md">
                    <span className="font-mono text-xs text-muted-foreground uppercase tracking-wide">
                      Приватная заметка — ученик не увидит
                    </span>
                    <button
                      onClick={() => setInputMode('comment')}
                      className="bg-transparent border-0 cursor-pointer text-muted-foreground hover:text-foreground p-1 flex"
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
                    className={[
                      'flex-1 rounded-lg px-3 py-2 text-sm text-foreground resize-none overflow-hidden leading-normal border outline-none',
                      inputMode === 'note' ? 'bg-muted' : 'bg-background',
                    ].join(' ')}
                    style={{ minHeight: 36, maxHeight: 160 }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSendThread(); }
                    }}
                  />
                  <button
                    disabled={sendingThread || !hasThreadContent}
                    onClick={handleSendThread}
                    className={[
                      'flex items-center justify-center shrink-0 border-0 rounded-full size-9 transition-colors',
                      hasThreadContent
                        ? 'bg-primary text-primary-foreground cursor-pointer hover:bg-primary/90'
                        : 'bg-muted text-muted-foreground cursor-default',
                    ].join(' ')}
                  >
                    <SendIcon />
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Подтверждение отправки на доработку */}
      <AlertDialog open={!!pendingRevision} onOpenChange={(open) => !open && setPendingRevision(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Отправить на доработку?</AlertDialogTitle>
            <AlertDialogDescription>
              Задание «{pendingRevision?.assignment?.title || ''}» будет возвращено ученику на доработку.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={() => {
                if (pendingRevision) handleUpdateAssignment(pendingRevision.id, 'needs_revision');
                setPendingRevision(null);
              }}
            >
              На доработку
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

/* ─── SummaryCard ─── */

function SummaryCard({ label, value, variant }: {
  label: string; value: number;
  variant: 'info' | 'warning' | 'success' | 'error' | 'accent' | 'default';
}) {
  const isError = variant === 'error';
  return (
    <div className="flex flex-col items-center justify-center gap-1 p-3 rounded-lg border bg-card min-w-[90px]">
      <span className={`text-2xl font-bold leading-none ${isError ? 'text-destructive' : 'text-foreground'}`}>
        {value}
      </span>
      <span className="text-xs text-center leading-tight text-muted-foreground">{label}</span>
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
        'flex items-center justify-center shrink-0 border-0 rounded-full size-9 transition-colors',
        active ? 'bg-muted text-foreground' : 'bg-transparent text-muted-foreground',
        disabled ? 'opacity-40 cursor-default' : 'cursor-pointer hover:text-foreground',
      ].join(' ')}
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
            'text-xs font-mono font-bold border',
            isNote ? 'bg-muted border-dashed text-muted-foreground'
              : isAdmin ? 'bg-primary text-primary-foreground border-transparent'
              : 'bg-muted text-muted-foreground',
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
            isNote ? 'text-muted-foreground' : isAdmin ? 'text-primary' : 'text-muted-foreground',
            isAdmin ? 'text-right' : 'text-left',
          ].join(' ')}>
            {entry.author.name}
            {isNote && <span className="ml-2">заметка</span>}
          </div>
        )}
        <div className={[
          'px-4 py-3 border',
          isNote
            ? 'bg-muted border-dashed rounded-xl'
            : isAdmin
              ? 'bg-primary text-primary-foreground border-transparent rounded-xl rounded-br-xs'
              : 'bg-muted rounded-xl rounded-bl-xs',
        ].join(' ')}>
          <div className={`text-sm leading-normal break-words ${isAdmin && !isNote ? 'text-primary-foreground' : 'text-foreground'}`}>
            {['text', 'comment', 'note'].includes(entry.type) ? (
              <span className="whitespace-pre-wrap">{entry.content}</span>
            ) : entry.type === 'file' ? (
              <div className="flex items-center gap-3">
                <span>{entry.metadata?.fileName || entry.content}</span>
                {entry.metadata?.url && (
                  <a href={entry.metadata.url} target="_blank" rel="noopener noreferrer" className="underline text-xs">
                    Скачать
                  </a>
                )}
              </div>
            ) : entry.type === 'audio' && entry.metadata?.url ? (
              <audio controls src={entry.metadata.url} className="max-w-full h-9" />
            ) : entry.type === 'link' ? (
              <a href={entry.content} target="_blank" rel="noopener noreferrer" className="underline break-all">
                {entry.content}
              </a>
            ) : null}
          </div>
          <div className={`text-[10px] mt-1 font-mono opacity-70 ${isAdmin ? 'text-left' : 'text-right'}`}>
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
