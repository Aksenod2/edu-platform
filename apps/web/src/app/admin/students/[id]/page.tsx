'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useRouter, useParams, usePathname } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { NotificationBell } from '@/lib/notification-bell';
import { DashboardLayout } from '@platform/ui/templates';
import { Spinner, Button } from '@platform/ui/atoms';

const ADMIN_NAV = [
  {
    label: 'Управление',
    items: [
      { label: 'Обзор',      href: '/admin',           icon: <GridIcon /> },
      { label: 'Ученики',    href: '/admin/students',  icon: <UsersIcon /> },
      { label: 'Потоки',     href: '/admin/streams',   icon: <StreamIcon /> },
      { label: 'Расписание', href: '/admin/schedule',  icon: <CalendarIcon /> },
      { label: 'Уведомления', href: '/admin/notifications', icon: <BellNavIcon /> },
      { label: 'API-доступ', href: '/admin/api-access', icon: <KeyIcon /> },
    ],
  },
];
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

const STATUS_COLORS: Record<string, string> = {
  assigned: '#2196F3',
  submitted: '#FF9800',
  reviewed: '#4CAF50',
  needs_revision: '#9C27B0',
};

export default function StudentProfilePage() {
  const { user, accessToken, loading, logout } = useAuth();
  const router = useRouter();
  const params = useParams();
  const pathname = usePathname();
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

  useEffect(() => {
    if (!loading && !user) router.push('/login');
    if (!loading && user && user.role !== 'admin') router.push('/dashboard');
    if (!loading && user?.mustChangePassword) router.push('/change-password');
  }, [user, loading, router]);

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
      // summary не критична, не показываем ошибку
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
      if (assignments.length === 0 && !loadingAssignments) {
        fetchAssignments();
      }
      if (!assignmentsSummary && !loadingSummary) {
        fetchSummary();
      }
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

  if (loading || loadingProfile) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh' }}>
        <Spinner size="lg" />
      </div>
    );
  }
  if (!user || user.role !== 'admin') return null;

  if (error && !data) {
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
        <div style={{ padding: 'var(--space-4)' }}>
          <a href="/admin/students" style={{ color: '#666', textDecoration: 'none' }}>← К списку учеников</a>
          <p style={{ color: '#dc3545', marginTop: 16 }}>{error}</p>
        </div>
      </DashboardLayout>
    );
  }

  if (!data) return null;

  const { student, profile, notes } = data;

  // Summary stats
  const totalAssigned = assignments.length;
  const totalSubmitted = assignments.filter((a) => a.status === 'submitted').length;
  const totalReviewed = assignments.filter((a) => a.status === 'reviewed').length;
  const now = new Date();
  const totalOverdue = assignments.filter((a) => {
    if (a.status === 'reviewed') return false;
    const dueDate = a.assignment?.dueDate;
    return dueDate && new Date(dueDate) < now;
  }).length;

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
    <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - var(--header-height))' }}>
      {/* Header */}
      <div style={{ padding: 'var(--space-4) var(--space-4) 0', maxWidth: 900, width: '100%', margin: '0 auto' }}>
        <a href="/admin/students" style={{ color: 'var(--color-text-tertiary)', textDecoration: 'none', fontSize: 'var(--text-sm)' }}>← К списку учеников</a>

        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginTop: 8, marginBottom: 4, gap: 'var(--space-3)' }}>
          <div style={{ minWidth: 0 }}>
            <h1 style={{ margin: 0, marginBottom: 4, fontSize: 'var(--text-xl)', fontWeight: 'var(--font-semibold)' }}>{student.name}</h1>
            <p style={{ color: 'var(--color-text-tertiary)', margin: 0, fontSize: 'var(--text-sm)' }}>
              {student.email} · Зарегистрирован: {new Date(student.createdAt).toLocaleDateString('ru-RU')}
            </p>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', flexShrink: 0 }}>
            {assignSuccess && (
              <span style={{ color: '#4CAF50', fontSize: 'var(--text-sm)', whiteSpace: 'nowrap' }}>{assignSuccess}</span>
            )}
            <Button variant="primary" size="sm" onClick={handleOpenAssignModal}>
              + Назначить задание
            </Button>
          </div>
        </div>

        {/* Summary stats — visible when assignments are loaded */}
        {assignments.length > 0 && (
          <div style={{
            display: 'flex', gap: 'var(--space-4)', marginTop: 'var(--space-3)',
            flexWrap: 'wrap',
          }}>
            <StatBadge label="Выдано" value={totalAssigned} color="#2196F3" />
            <StatBadge label="Сдано" value={totalSubmitted} color="#FF9800" />
            <StatBadge label="Проверено" value={totalReviewed} color="#4CAF50" />
            <StatBadge label="Просрочено" value={totalOverdue} color="#f44336" />
          </div>
        )}

        {/* Error banner */}
        {error && (
          <div style={{
            background: 'var(--color-error-dim, #f8d7da)', border: '1px solid var(--color-error, #dc3545)',
            borderRadius: 6, padding: '8px 12px', marginTop: 12, color: 'var(--color-error, #dc3545)',
            fontSize: 'var(--text-sm)', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          }}>
            <span>{error}</span>
            <button onClick={() => setError('')} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'inherit', fontSize: 16 }}>×</button>
          </div>
        )}

        {/* Assign modal — shown above tabs regardless of active tab */}
        {showAssignModal && (
          <div style={{
            background: 'var(--color-bg-elevated)', border: '1px solid var(--color-border-default)',
            borderRadius: 8, padding: 16, marginTop: 'var(--space-3)',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <strong>Назначить задание ученику {student.name}</strong>
              <button onClick={() => setShowAssignModal(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, color: 'var(--color-text-tertiary)' }}>×</button>
            </div>
            {loadingAllAssignments ? (
              <div style={{ display: 'flex', justifyContent: 'center', padding: 16 }}><Spinner size="md" /></div>
            ) : allAssignments.length === 0 ? (
              <p style={{ color: 'var(--color-text-tertiary)', fontSize: 'var(--text-sm)' }}>Нет доступных заданий. Создайте задание в разделе потока.</p>
            ) : (
              <>
                <select
                  value={selectedAssignmentId}
                  onChange={(e) => setSelectedAssignmentId(e.target.value)}
                  style={{
                    width: '100%', padding: '8px 12px', borderRadius: 4,
                    border: '1px solid var(--color-border-default)',
                    background: 'var(--color-bg-surface)', color: 'var(--color-text-primary)',
                    fontSize: 'var(--text-sm)', marginBottom: 12,
                  }}
                >
                  <option value="">Выберите задание...</option>
                  {allAssignments.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.title} {a.stream ? `(${a.stream.name})` : ''} — {a.type === 'short' ? 'Короткое' : 'Длинное'}
                    </option>
                  ))}
                </select>
                <div style={{ display: 'flex', gap: 8 }}>
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={handleAssignToStudent}
                    disabled={!selectedAssignmentId}
                    loading={assigning}
                  >
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
        <div style={{
          display: 'flex', gap: 0, marginTop: 'var(--space-4)',
          borderBottom: '1px solid var(--color-border-default)',
        }}>
          {([
            { key: 'profile' as Tab, label: 'Профиль' },
            { key: 'assignments' as Tab, label: 'Задания' },
            { key: 'thread' as Tab, label: 'Тред' },
          ]).map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setActiveTab(key)}
              style={{
                padding: 'var(--space-2) var(--space-4)',
                border: 'none',
                borderBottom: activeTab === key ? '2px solid var(--color-accent-red, #e53935)' : '2px solid transparent',
                background: 'none',
                cursor: 'pointer',
                fontSize: 'var(--text-sm)',
                fontWeight: activeTab === key ? 'var(--font-semibold)' : 'normal',
                color: activeTab === key ? 'var(--color-text-primary)' : 'var(--color-text-tertiary)',
                fontFamily: 'var(--font-sans)',
                transition: 'color 0.15s, border-color 0.15s',
              }}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Tab content */}
      <div style={{ flex: 1, overflow: 'auto', maxWidth: 900, width: '100%', margin: '0 auto' }}>
        {activeTab === 'profile' && (
          <div style={{ padding: 'var(--space-4)' }}>
            {/* Анкета */}
            <section>
              <h2 style={{ fontSize: 20, marginBottom: 12 }}>Анкета (Задание №0)</h2>
              {profile ? (
                <div style={{ background: 'var(--color-bg-elevated)', border: '1px solid var(--color-border-default)', borderRadius: 6, padding: 16 }}>
                  <div style={{ marginBottom: 12 }}>
                    <strong>Резюме:</strong>
                    <p style={{ margin: '4px 0 0', whiteSpace: 'pre-wrap' }}>{profile.resume || '—'}</p>
                  </div>
                  <div style={{ marginBottom: 12 }}>
                    <strong>Портфолио:</strong>
                    <p style={{ margin: '4px 0 0' }}>{profile.portfolio || '—'}</p>
                  </div>
                  <div style={{ marginBottom: 12 }}>
                    <strong>Контакты:</strong>
                    <p style={{ margin: '4px 0 0' }}>
                      {profile.contacts
                        ? `Email: ${(profile.contacts as { email?: string; telegram?: string }).email || '—'}, Telegram: ${(profile.contacts as { email?: string; telegram?: string }).telegram || '—'}`
                        : '—'}
                    </p>
                  </div>
                  <div style={{ marginBottom: 12 }}>
                    <strong>Направление:</strong>
                    <p style={{ margin: '4px 0 0' }}>{profile.direction || '—'}</p>
                  </div>
                  {profile.questionnaireCompletedAt && (
                    <p style={{ color: '#28a745', fontSize: 14 }}>
                      Заполнена: {new Date(profile.questionnaireCompletedAt).toLocaleDateString('ru-RU')}
                    </p>
                  )}
                  {!profile.questionnaireCompletedAt && (
                    <p style={{ color: '#dc3545', fontSize: 14 }}>Анкета не заполнена</p>
                  )}
                </div>
              ) : (
                <p style={{ color: '#999' }}>Ученик ещё не заполнил анкету.</p>
              )}
            </section>

            {/* Заметки преподавателя */}
            <section style={{ marginTop: 32 }}>
              <h2 style={{ fontSize: 20, marginBottom: 12 }}>Наблюдения преподавателя</h2>
              <form onSubmit={handleAddNote} style={{ marginBottom: 20 }}>
                <textarea
                  value={noteContent}
                  onChange={(e) => setNoteContent(e.target.value)}
                  placeholder="Добавить наблюдение или заметку..."
                  rows={3}
                  style={{ width: '100%', padding: 8, border: '1px solid #ccc', borderRadius: 4, fontFamily: 'sans-serif', boxSizing: 'border-box', marginBottom: 8 }}
                />
                <Button type="submit" variant="primary" disabled={!noteContent.trim()} loading={savingNote}>
                  {savingNote ? 'Сохранение...' : 'Добавить заметку'}
                </Button>
                {noteMessage && (
                  <span style={{ marginLeft: 12, color: '#28a745' }}>{noteMessage}</span>
                )}
              </form>
              {notes && notes.length > 0 ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {notes.map((note: TeacherNote) => (
                    <div key={note.id} style={{ background: 'var(--color-bg-elevated)', border: '1px solid var(--color-border-default)', borderRadius: 6, padding: 12 }}>
                      <p style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{note.content}</p>
                      <p style={{ margin: '8px 0 0', fontSize: 12, color: '#999' }}>
                        {note.author.name} — {new Date(note.createdAt).toLocaleString('ru-RU')}
                      </p>
                    </div>
                  ))}
                </div>
              ) : (
                <p style={{ color: '#999' }}>Заметок пока нет.</p>
              )}
            </section>
          </div>
        )}

        {activeTab === 'assignments' && (
          <div style={{ padding: 'var(--space-4)' }}>
            {/* Summary block */}
            {(assignmentsSummary || loadingSummary) && (
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))',
                gap: 'var(--space-3)',
                marginBottom: 'var(--space-4)',
                padding: 'var(--space-3)',
                background: 'var(--color-bg-elevated)',
                border: '1px solid var(--color-border-default)',
                borderRadius: 8,
              }}>
                {loadingSummary && !assignmentsSummary ? (
                  <div style={{ gridColumn: '1/-1', display: 'flex', justifyContent: 'center', padding: 8 }}>
                    <Spinner size="sm" />
                  </div>
                ) : assignmentsSummary ? (
                  <>
                    <SummaryCard label="Выдано" value={assignmentsSummary.total} color="#2196F3" />
                    <SummaryCard label="Сдано" value={assignmentsSummary.submitted} color="#FF9800" />
                    <SummaryCard label="Проверено" value={assignmentsSummary.reviewed} color="#4CAF50" />
                    <SummaryCard label="На доработке" value={assignmentsSummary.needs_revision} color="#9C27B0" />
                    <SummaryCard label="Просрочено" value={assignmentsSummary.overdue} color="#f44336" />
                  </>
                ) : null}
              </div>
            )}

            {/* Status filter */}
            <div style={{ display: 'flex', gap: 'var(--space-2)', marginBottom: 'var(--space-4)', flexWrap: 'wrap' }}>
              {[
                { key: 'all', label: 'Все' },
                { key: 'assigned', label: 'Выдано' },
                { key: 'submitted', label: 'Сдано' },
                { key: 'reviewed', label: 'Проверено' },
                { key: 'needs_revision', label: 'На доработке' },
                { key: 'overdue', label: 'Просрочено' },
              ].map(({ key, label }) => (
                <button
                  key={key}
                  onClick={() => setStatusFilter(key)}
                  style={{
                    padding: '4px 12px',
                    borderRadius: 16,
                    border: statusFilter === key ? '1px solid var(--color-accent-red, #e53935)' : '1px solid var(--color-border-default)',
                    background: statusFilter === key ? 'var(--color-accent-red-dim, rgba(229,57,53,0.1))' : 'transparent',
                    color: statusFilter === key ? 'var(--color-accent-red, #e53935)' : 'var(--color-text-secondary)',
                    cursor: 'pointer',
                    fontSize: 'var(--text-sm)',
                    fontFamily: 'var(--font-sans)',
                  }}
                >
                  {label}
                </button>
              ))}
            </div>

            {loadingAssignments ? (
              <div style={{ display: 'flex', justifyContent: 'center', padding: 32 }}><Spinner size="lg" /></div>
            ) : filteredAssignments.length === 0 ? (
              <p style={{ color: 'var(--color-text-tertiary)', textAlign: 'center', padding: 32 }}>
                {assignments.length === 0 ? 'Заданий пока нет.' : 'Нет заданий с выбранным фильтром.'}
              </p>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{
                  width: '100%', borderCollapse: 'collapse', fontSize: 'var(--text-sm)',
                }}>
                  <thead>
                    <tr style={{ borderBottom: '2px solid var(--color-border-default)' }}>
                      <th style={thStyle}>Задание</th>
                      <th style={thStyle}>Статус</th>
                      <th style={thStyle}>Поток</th>
                      <th style={thStyle}>Выдано</th>
                      <th style={thStyle}>Срок сдачи</th>
                      <th style={thStyle}>Действия</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredAssignments.map((sa) => {
                      const isOverdue = sa.status !== 'reviewed' && sa.assignment?.dueDate && new Date(sa.assignment.dueDate) < now;
                      return (
                        <tr key={sa.id} style={{ borderBottom: '1px solid var(--color-border-subtle, #eee)' }}>
                          <td style={tdStyle}>{sa.assignment?.title || '—'}</td>
                          <td style={tdStyle}>
                            <span style={{
                              display: 'inline-block',
                              padding: '2px 8px',
                              borderRadius: 12,
                              fontSize: 12,
                              fontWeight: 600,
                              background: `${STATUS_COLORS[sa.status] || '#999'}20`,
                              color: STATUS_COLORS[sa.status] || '#999',
                            }}>
                              {STATUS_LABELS[sa.status] || sa.status}
                            </span>
                            {isOverdue && (
                              <span style={{
                                display: 'inline-block', marginLeft: 6,
                                padding: '2px 6px', borderRadius: 12, fontSize: 11,
                                background: '#f4433620', color: '#f44336', fontWeight: 600,
                              }}>
                                Просрочено
                              </span>
                            )}
                          </td>
                          <td style={tdStyle}>{sa.assignment?.stream?.name || '—'}</td>
                          <td style={tdStyle}>{new Date(sa.createdAt).toLocaleDateString('ru-RU')}</td>
                          <td style={tdStyle}>
                            {sa.assignment?.dueDate
                              ? new Date(sa.assignment.dueDate).toLocaleDateString('ru-RU')
                              : '—'}
                          </td>
                          <td style={tdStyle}>
                            {sa.status === 'submitted' && (
                              <div style={{ display: 'flex', gap: 6 }}>
                                <button
                                  onClick={() => handleUpdateAssignment(sa.id, 'reviewed')}
                                  disabled={updatingId === sa.id}
                                  style={{
                                    padding: '3px 10px', borderRadius: 4, border: 'none',
                                    background: '#4CAF50', color: '#fff', cursor: 'pointer',
                                    fontSize: 12, opacity: updatingId === sa.id ? 0.6 : 1,
                                  }}
                                >
                                  Принять
                                </button>
                                <button
                                  onClick={() => handleUpdateAssignment(sa.id, 'needs_revision')}
                                  disabled={updatingId === sa.id}
                                  style={{
                                    padding: '3px 10px', borderRadius: 4,
                                    border: '1px solid #9C27B0', background: 'transparent',
                                    color: '#9C27B0', cursor: 'pointer',
                                    fontSize: 12, opacity: updatingId === sa.id ? 0.6 : 1,
                                  }}
                                >
                                  На доработку
                                </button>
                              </div>
                            )}
                            {sa.status === 'assigned' && '—'}
                            {sa.status === 'needs_revision' && (
                              <span style={{ color: '#9C27B0', fontSize: 12 }}>↩ Ожидает пересдачи</span>
                            )}
                            {sa.status === 'reviewed' && (
                              <span style={{ color: 'var(--color-text-disabled)', fontSize: 12 }}>✓ Проверено</span>
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

        {activeTab === 'thread' && (
          <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
            {/* Thread messages */}
            <div style={{
              flex: 1, overflowY: 'auto', padding: 'var(--space-4)',
              display: 'flex', flexDirection: 'column', gap: 'var(--space-2)',
            }}>
              {loadingThread ? (
                <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <Spinner size="lg" />
                </div>
              ) : threadEntries.length === 0 ? (
                <div style={{
                  flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  <p style={{
                    color: 'var(--color-text-tertiary)', fontSize: 'var(--text-sm)',
                    fontFamily: 'var(--font-mono)', letterSpacing: 'var(--tracking-wide)',
                    textTransform: 'uppercase',
                  }}>
                    Тред пуст
                  </p>
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
            <div style={{
              borderTop: '1px solid var(--color-border-subtle)',
              padding: 'var(--space-3) var(--space-4)',
              background: 'var(--color-bg-surface)',
            }}>
              {inputMode === 'note' && (
                <div style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: 'var(--space-2) var(--space-3)', marginBottom: 'var(--space-2)',
                  background: 'var(--color-warning-dim)', border: '1px solid var(--color-warning)',
                  borderRadius: 'var(--radius-sm)',
                }}>
                  <span style={{
                    fontSize: 'var(--text-xs)', fontFamily: 'var(--font-mono)',
                    color: 'var(--color-warning)', letterSpacing: 'var(--tracking-wide)',
                    textTransform: 'uppercase',
                  }}>
                    Приватная заметка — ученик не увидит
                  </span>
                  <button onClick={() => setInputMode('comment')} style={{
                    background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-warning)',
                    padding: 'var(--space-1)', display: 'flex',
                  }}>
                    ×
                  </button>
                </div>
              )}

              <div style={{ display: 'flex', alignItems: 'flex-end', gap: 'var(--space-2)' }}>
                <div style={{ display: 'flex', gap: 'var(--space-1)' }}>
                  <input ref={fileInputRef} type="file" onChange={handleFileUpload} style={{ display: 'none' }} />
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
                  style={{
                    flex: 1,
                    padding: 'var(--space-2) var(--space-3)',
                    borderRadius: 'var(--radius-lg)',
                    border: `1px solid ${inputMode === 'note' ? 'var(--color-warning)' : 'var(--color-border-default)'}`,
                    fontSize: 'var(--text-sm)',
                    fontFamily: 'var(--font-sans)',
                    background: inputMode === 'note' ? 'var(--color-warning-dim)' : 'var(--color-bg-elevated)',
                    color: 'var(--color-text-primary)',
                    resize: 'none', overflow: 'hidden',
                    lineHeight: 'var(--leading-normal)', outline: 'none',
                    minHeight: 36, maxHeight: 160,
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSendThread(); }
                  }}
                />
                <button
                  disabled={sendingThread || !hasThreadContent}
                  onClick={handleSendThread}
                  style={{
                    width: 36, height: 36, borderRadius: 'var(--radius-full)',
                    border: 'none',
                    background: hasThreadContent ? 'var(--color-accent-red)' : 'var(--color-bg-elevated)',
                    color: hasThreadContent ? 'var(--color-text-primary)' : 'var(--color-text-disabled)',
                    cursor: hasThreadContent ? 'pointer' : 'default',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
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
    </DashboardLayout>
  );
}

/* ─── Table styles ─── */

const thStyle: React.CSSProperties = {
  textAlign: 'left', padding: '8px 12px', fontWeight: 600,
  fontSize: 'var(--text-xs)', textTransform: 'uppercase' as const,
  color: 'var(--color-text-tertiary)', letterSpacing: '0.05em',
};

const tdStyle: React.CSSProperties = {
  padding: '10px 12px', verticalAlign: 'middle',
};

/* ─── Stat badge ─── */

function StatBadge({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 6,
      padding: '4px 12px', borderRadius: 16,
      background: `${color}15`, border: `1px solid ${color}30`,
    }}>
      <span style={{ fontWeight: 700, fontSize: 'var(--text-lg)', color }}>{value}</span>
      <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</span>
    </div>
  );
}

function SummaryCard({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      padding: 'var(--space-2) var(--space-3)', gap: 4,
      background: `${color}10`, border: `1px solid ${color}30`, borderRadius: 8,
      minWidth: 90,
    }}>
      <span style={{ fontSize: 'var(--text-2xl)', fontWeight: 700, color, lineHeight: 1 }}>{value}</span>
      <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-secondary)', textAlign: 'center', lineHeight: 1.2 }}>{label}</span>
    </div>
  );
}

/* ─── Compose button ─── */

function ComposeButton({ children, title, onClick, disabled, active }: {
  children: React.ReactNode; title: string; onClick: () => void; disabled?: boolean; active?: boolean;
}) {
  return (
    <button
      title={title} onClick={onClick} disabled={disabled}
      style={{
        width: 36, height: 36, borderRadius: 'var(--radius-full)', border: 'none',
        background: active ? 'var(--color-bg-overlay)' : 'transparent',
        color: active ? 'var(--color-text-primary)' : 'var(--color-text-tertiary)',
        cursor: disabled ? 'default' : 'pointer',
        display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
        opacity: disabled ? 0.38 : 1,
      }}
    >
      {children}
    </button>
  );
}

/* ─── Thread bubble ─── */

function ThreadBubble({ entry, showAuthor }: { entry: ThreadEntry; showAuthor: boolean }) {
  const isAdmin = entry.author.role === 'admin';
  const isNote = entry.type === 'note';
  const date = new Date(entry.createdAt);
  const initials = entry.author.name.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase();

  return (
    <div style={{
      display: 'flex', flexDirection: isAdmin ? 'row-reverse' : 'row',
      alignItems: 'flex-end', gap: 'var(--space-2)',
      marginTop: showAuthor ? 'var(--space-4)' : 'var(--space-1)',
      maxWidth: '85%', alignSelf: isAdmin ? 'flex-end' : 'flex-start',
    }}>
      {showAuthor ? (
        <div style={{
          width: 32, height: 32, borderRadius: 'var(--radius-full)',
          background: isNote ? 'var(--color-warning-dim)' : isAdmin ? 'var(--color-accent-red-dim)' : 'var(--color-bg-overlay)',
          border: `1px solid ${isNote ? 'var(--color-warning)' : isAdmin ? 'var(--color-accent-red)' : 'var(--color-border-default)'}`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 'var(--text-xs)', fontFamily: 'var(--font-mono)', fontWeight: 'var(--font-bold)',
          color: isNote ? 'var(--color-warning)' : isAdmin ? 'var(--color-accent-red)' : 'var(--color-text-secondary)',
          flexShrink: 0,
        }}>
          {initials}
        </div>
      ) : (
        <div style={{ width: 32, flexShrink: 0 }} />
      )}
      <div style={{ minWidth: 0 }}>
        {showAuthor && (
          <div style={{
            fontSize: 'var(--text-xs)', fontFamily: 'var(--font-mono)',
            color: isNote ? 'var(--color-warning)' : isAdmin ? 'var(--color-accent-red)' : 'var(--color-text-tertiary)',
            marginBottom: 'var(--space-1)', letterSpacing: 'var(--tracking-wide)',
            textTransform: 'uppercase', textAlign: isAdmin ? 'right' : 'left',
          }}>
            {entry.author.name}
            {isNote && <span style={{ marginLeft: 'var(--space-2)', color: 'var(--color-warning)' }}>заметка</span>}
          </div>
        )}
        <div style={{
          padding: 'var(--space-3) var(--space-4)',
          borderRadius: isAdmin
            ? 'var(--radius-xl) var(--radius-xl) var(--radius-xs) var(--radius-xl)'
            : 'var(--radius-xl) var(--radius-xl) var(--radius-xl) var(--radius-xs)',
          background: isNote ? 'var(--color-warning-dim)' : isAdmin ? 'var(--color-bg-overlay)' : 'var(--color-bg-elevated)',
          border: `1px solid ${isNote ? 'var(--color-warning)' : 'var(--color-border-default)'}`,
          ...(isNote && { borderStyle: 'dashed' as const }),
        }}>
          <div style={{ fontSize: 'var(--text-sm)', lineHeight: 'var(--leading-normal)', color: 'var(--color-text-primary)', wordBreak: 'break-word' }}>
            {['text', 'comment', 'note'].includes(entry.type) ? (
              <span style={{ whiteSpace: 'pre-wrap' }}>{entry.content}</span>
            ) : entry.type === 'file' ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
                <span>{entry.metadata?.fileName || entry.content}</span>
                {entry.metadata?.url && (
                  <a href={entry.metadata.url} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--color-info)', fontSize: 'var(--text-xs)' }}>
                    Скачать
                  </a>
                )}
              </div>
            ) : entry.type === 'audio' && entry.metadata?.url ? (
              <audio controls src={entry.metadata.url} style={{ maxWidth: '100%', height: 36 }} />
            ) : entry.type === 'link' ? (
              <a href={entry.content} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--color-info)', wordBreak: 'break-all' }}>
                {entry.content}
              </a>
            ) : null}
          </div>
          <div style={{
            fontSize: 10, color: 'var(--color-text-disabled)', marginTop: 'var(--space-1)',
            textAlign: isAdmin ? 'left' : 'right', fontFamily: 'var(--font-mono)',
          }}>
            {date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}
          </div>
        </div>
        {entry.assignment && (
          <div style={{ marginTop: 'var(--space-1)', fontSize: 'var(--text-xs)', color: 'var(--color-text-disabled)', fontFamily: 'var(--font-mono)' }}>
            К заданию: {entry.assignment.title}
          </div>
        )}
      </div>
    </div>
  );
}

/* ─── SVG Icons ─── */

function GridIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="1" y="1" width="5" height="5" /><rect x="10" y="1" width="5" height="5" />
      <rect x="1" y="10" width="5" height="5" /><rect x="10" y="10" width="5" height="5" />
    </svg>
  );
}

function UsersIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <circle cx="6" cy="5" r="3" /><path d="M1 14c0-3 2-5 5-5s5 2 5 5" />
      <circle cx="12" cy="4" r="2" /><path d="M15 13c0-2-1-4-3-4" />
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
      <rect x="1" y="3" width="14" height="12" /><path d="M1 7h14M5 1v4M11 1v4" />
    </svg>
  );
}

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


function KeyIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <circle cx="6" cy="6" r="3.5" />
      <path d="M8.5 8.5l5.5 5.5M11 11l1.5 1.5" />
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
