'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
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
  getThread,
  addThreadEntry,
  uploadThreadFile,
  type ThreadEntry,
  type ThreadEntryType,
} from '@/lib/api';

export default function AdminStudentThreadPage() {
  const { user, accessToken, loading, logout } = useAuth();
  const router = useRouter();
  const params = useParams();
  const pathname = usePathname();
  const studentId = params.id as string;

  const [studentName, setStudentName] = useState('');
  const [entries, setEntries] = useState<ThreadEntry[]>([]);
  const [loadingData, setLoadingData] = useState(true);
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);

  // Input state
  const [inputMode, setInputMode] = useState<'comment' | 'note'>('comment');
  const [content, setContent] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!loading && !user) router.push('/login');
    if (!loading && user && user.role !== 'admin') router.push('/dashboard');
    if (!loading && user?.mustChangePassword) router.push('/change-password');
  }, [user, loading, router]);

  const fetchThread = useCallback(async () => {
    if (!accessToken || !studentId) return;
    setLoadingData(true);
    try {
      const data = await getThread(accessToken, studentId);
      setStudentName(data.student.name);
      setEntries(data.entries);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка загрузки треда');
    } finally {
      setLoadingData(false);
    }
  }, [accessToken, studentId]);

  useEffect(() => {
    if (accessToken && user?.role === 'admin') {
      fetchThread();
    }
  }, [accessToken, user, fetchThread]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [entries]);

  const handleSend = async () => {
    if (!accessToken || !content.trim()) return;
    setSending(true);
    try {
      const { entry } = await addThreadEntry(accessToken, studentId, {
        type: inputMode as ThreadEntryType,
        content: content.trim(),
      });
      setEntries((prev) => [...prev, entry]);
      setContent('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка отправки');
    } finally {
      setSending(false);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !accessToken) return;

    if (file.size > 50 * 1024 * 1024) {
      setError('Файл превышает максимальный размер 50MB');
      return;
    }

    setSending(true);
    try {
      const { entry } = await uploadThreadFile(accessToken, studentId, file, 'file');
      setEntries((prev) => [...prev, entry]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка загрузки файла');
    } finally {
      setSending(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
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
      <div style={{ marginBottom: 24 }}>
        <button
          onClick={() => router.push('/admin/students')}
          style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 14, color: '#666', marginBottom: 8, display: 'block' }}
        >
          ← К списку учеников
        </button>
        <h1 style={{ fontSize: 24, fontWeight: 700, margin: 0 }}>
          Тред: {studentName || 'Загрузка...'}
        </h1>
      </div>

      {error && (
        <div style={{ padding: '12px 16px', background: '#fee', color: '#c00', borderRadius: 8, marginBottom: 16, userSelect: 'text', cursor: 'text' }}>
          {error}
          <button onClick={() => setError('')} style={{ float: 'right', background: 'none', border: 'none', cursor: 'pointer', color: '#c00' }}>✕</button>
        </div>
      )}

      {/* Thread entries */}
      <div style={{ border: '1px solid #e0e0e0', borderRadius: 12, padding: 16, minHeight: 300, maxHeight: 500, overflowY: 'auto', marginBottom: 16, background: '#fafafa' }}>
        {loadingData ? (
          <p style={{ color: '#999', textAlign: 'center', paddingTop: 100 }}>Загрузка...</p>
        ) : entries.length === 0 ? (
          <p style={{ color: '#999', textAlign: 'center', paddingTop: 100 }}>Тред пуст</p>
        ) : (
          entries.map((entry) => (
            <EntryCard key={entry.id} entry={entry} />
          ))
        )}
        <div ref={bottomRef} />
      </div>

      {/* Admin input area */}
      <div style={{ border: '1px solid #e0e0e0', borderRadius: 12, padding: 16 }}>
        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          <Button
            variant={inputMode === 'comment' ? 'primary' : 'ghost'}
            size="sm"
            onClick={() => setInputMode('comment')}
          >
            💬 Комментарий
          </Button>
          <Button
            variant={inputMode === 'note' ? 'secondary' : 'ghost'}
            size="sm"
            onClick={() => setInputMode('note')}
          >
            📝 Заметка (скрытая)
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            onChange={handleFileUpload}
            style={{ display: 'none' }}
          />
          <Button
            variant="ghost"
            size="sm"
            disabled={sending}
            onClick={() => fileInputRef.current?.click()}
          >
            📎 Файл
          </Button>
        </div>

        {inputMode === 'note' && (
          <div style={{ fontSize: 12, color: '#963', marginBottom: 8 }}>
            Заметка видна только преподавателям. Ученик её не увидит.
          </div>
        )}

        <div style={{ display: 'flex', gap: 8 }}>
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder={inputMode === 'comment' ? 'Комментарий для ученика...' : 'Приватная заметка...'}
            style={{ flex: 1, padding: 10, borderRadius: 8, border: '1px solid #ccc', minHeight: 60, resize: 'vertical', fontFamily: 'inherit', fontSize: 14 }}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
          />
          <Button
            variant="primary"
            disabled={sending || !content.trim()}
            onClick={handleSend}
            style={{ alignSelf: 'flex-end' }}
          >
            {sending ? '...' : 'Отправить'}
          </Button>
        </div>
      </div>
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

function EntryCard({ entry }: { entry: ThreadEntry }) {
  const isAdmin = entry.author.role === 'admin';
  const isNote = entry.type === 'note';
  const date = new Date(entry.createdAt);

  const typeLabels: Record<string, string> = {
    text: '', file: '📎', audio: '🎵', link: '🔗', comment: '💬', note: '📝',
  };

  const bgColor = isNote ? 'var(--color-warning-dim)' : isAdmin ? 'var(--color-info-dim)' : 'var(--color-bg-surface)';
  const borderColor = isNote ? '#e0c090' : isAdmin ? '#99c' : '#e0e0e0';

  return (
    <div
      style={{
        padding: 12, marginBottom: 8, borderRadius: 8,
        border: `1px solid ${borderColor}`, background: bgColor,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: isNote ? '#963' : isAdmin ? '#339' : '#333' }}>
          {entry.author.name}
          {isAdmin && !isNote && ' (преподаватель)'}
          {isNote && ' (заметка)'}
        </span>
        <span style={{ fontSize: 11, color: '#999' }}>
          {date.toLocaleDateString('ru-RU')} {date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}
        </span>
      </div>

      <div style={{ fontSize: 14 }}>
        {typeLabels[entry.type] && <span style={{ marginRight: 4 }}>{typeLabels[entry.type]}</span>}

        {['text', 'comment', 'note'].includes(entry.type) ? (
          <span style={{ whiteSpace: 'pre-wrap' }}>{entry.content}</span>
        ) : entry.type === 'link' ? (
          <span>
            {entry.content.includes('\n') ? (
              <>
                <span>{entry.content.split('\n')[0]}</span>
                <br />
                <a href={entry.content.split('\n')[1]} target="_blank" rel="noopener noreferrer" style={{ color: '#06c', wordBreak: 'break-all' }}>
                  {entry.content.split('\n')[1]}
                </a>
              </>
            ) : (
              <a href={entry.content} target="_blank" rel="noopener noreferrer" style={{ color: '#06c', wordBreak: 'break-all' }}>
                {entry.content}
              </a>
            )}
          </span>
        ) : entry.type === 'file' ? (
          <span>
            {entry.metadata?.fileName || entry.content}
            {entry.metadata?.url && (
              <a href={entry.metadata.url} target="_blank" rel="noopener noreferrer" style={{ marginLeft: 8, color: '#06c', fontSize: 12 }}>
                Скачать
              </a>
            )}
            {entry.metadata?.size && (
              <span style={{ marginLeft: 8, fontSize: 11, color: '#999' }}>
                ({(entry.metadata.size / 1024 / 1024).toFixed(1)} МБ)
              </span>
            )}
          </span>
        ) : entry.type === 'audio' ? (
          <span>
            {entry.metadata?.url ? (
              <audio controls src={entry.metadata.url} style={{ maxWidth: '100%' }} />
            ) : (
              <span>Аудиозапись</span>
            )}
          </span>
        ) : null}
      </div>

      {entry.assignment && (
        <div style={{ marginTop: 6, fontSize: 11, color: '#666' }}>
          К заданию: {entry.assignment.title}
        </div>
      )}
    </div>
  );
}
