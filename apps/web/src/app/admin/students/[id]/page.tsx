'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter, useParams, usePathname } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
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
    ],
  },
];
import {
  getProfile,
  addTeacherNote,
  type ProfileResponse,
  type TeacherNote,
} from '@/lib/api';

export default function StudentProfilePage() {
  const { user, accessToken, loading, logout } = useAuth();
  const router = useRouter();
  const params = useParams();
  const pathname = usePathname();
  const studentId = params.id as string;

  const [data, setData] = useState<ProfileResponse | null>(null);
  const [loadingProfile, setLoadingProfile] = useState(true);
  const [error, setError] = useState('');

  const [noteContent, setNoteContent] = useState('');
  const [savingNote, setSavingNote] = useState(false);
  const [noteMessage, setNoteMessage] = useState('');

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

  useEffect(() => {
    if (accessToken && studentId) fetchProfile();
  }, [accessToken, studentId, fetchProfile]);

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

  return (
    <DashboardLayout
      currentPath={pathname}
      header={{
        user: { name: user.name, role: 'admin' },
        onLogout: async () => { await logout(); router.push('/login'); },
        platformName: 'PLATFORM ADMIN',
      }}
      sidebar={{ sections: ADMIN_NAV }}
    >
    <div style={{ padding: 'var(--space-4)', maxWidth: 800 }}>
      <a href="/admin/students" style={{ color: '#666', textDecoration: 'none' }}>← К списку учеников</a>

      <h1 style={{ marginTop: 16 }}>{student.name}</h1>
      <p style={{ color: '#666' }}>{student.email}</p>
      <p style={{ color: '#999', fontSize: 14 }}>
        Зарегистрирован: {new Date(student.createdAt).toLocaleDateString('ru-RU')}
      </p>

      {error && (
        <div style={{ background: '#f8d7da', border: '1px solid #dc3545', borderRadius: 6, padding: 12, marginTop: 16, color: '#721c24' }}>
          {error}
        </div>
      )}

      {/* Анкета */}
      <section style={{ marginTop: 24 }}>
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
          <Button
            type="submit"
            variant="primary"
            disabled={!noteContent.trim()}
            loading={savingNote}
          >
            {savingNote ? 'Сохранение...' : 'Добавить заметку'}
          </Button>
          {noteMessage && (
            <span style={{ marginLeft: 12, color: '#28a745' }}>{noteMessage}</span>
          )}
        </form>

        {notes && notes.length > 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {notes.map((note: TeacherNote) => (
              <div
                key={note.id}
                style={{ background: 'var(--color-bg-elevated)', border: '1px solid var(--color-border-default)', borderRadius: 6, padding: 12 }}
              >
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
    </DashboardLayout>
  );
}

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
