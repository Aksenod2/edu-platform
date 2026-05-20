'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import {
  getThread,
  addThreadEntry,
  uploadThreadFile,
  type ThreadEntry,
  type ThreadEntryType,
} from '@/lib/api';

export default function AdminStudentThreadPage() {
  const { user, accessToken, loading } = useAuth();
  const router = useRouter();
  const params = useParams();
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

  if (loading) return <p style={{ padding: 32, fontFamily: 'sans-serif' }}>Загрузка...</p>;
  if (!user || user.role !== 'admin') return null;

  return (
    <main style={{ padding: 32, fontFamily: 'sans-serif', maxWidth: 800, margin: '0 auto' }}>
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
          <button
            onClick={() => setInputMode('comment')}
            style={{
              padding: '6px 14px', borderRadius: 6,
              border: inputMode === 'comment' ? '2px solid #339' : '1px solid #ccc',
              background: inputMode === 'comment' ? '#339' : '#fff',
              color: inputMode === 'comment' ? '#fff' : '#333',
              cursor: 'pointer', fontSize: 13, fontWeight: 500,
            }}
          >
            💬 Комментарий
          </button>
          <button
            onClick={() => setInputMode('note')}
            style={{
              padding: '6px 14px', borderRadius: 6,
              border: inputMode === 'note' ? '2px solid #963' : '1px solid #ccc',
              background: inputMode === 'note' ? '#963' : '#fff',
              color: inputMode === 'note' ? '#fff' : '#333',
              cursor: 'pointer', fontSize: 13, fontWeight: 500,
            }}
          >
            📝 Заметка (скрытая)
          </button>
          <input
            ref={fileInputRef}
            type="file"
            onChange={handleFileUpload}
            style={{ display: 'none' }}
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={sending}
            style={{
              padding: '6px 14px', borderRadius: 6,
              border: '1px solid #ccc', background: '#fff',
              cursor: 'pointer', fontSize: 13, color: '#333',
            }}
          >
            📎 Файл
          </button>
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
          <button
            onClick={handleSend}
            disabled={sending || !content.trim()}
            style={{
              padding: '10px 20px', borderRadius: 8, border: 'none',
              background: inputMode === 'note' ? '#963' : '#339',
              color: '#fff', cursor: 'pointer', alignSelf: 'flex-end',
              opacity: sending || !content.trim() ? 0.5 : 1,
            }}
          >
            {sending ? '...' : 'Отправить'}
          </button>
        </div>
      </div>
    </main>
  );
}

function EntryCard({ entry }: { entry: ThreadEntry }) {
  const isAdmin = entry.author.role === 'admin';
  const isNote = entry.type === 'note';
  const date = new Date(entry.createdAt);

  const typeLabels: Record<string, string> = {
    text: '', file: '📎', audio: '🎵', link: '🔗', comment: '💬', note: '📝',
  };

  const bgColor = isNote ? '#fff8ee' : isAdmin ? '#eef' : '#fff';
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
