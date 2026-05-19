'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import {
  getThread,
  addThreadEntry,
  uploadThreadFile,
  type ThreadEntry,
  type ThreadEntryType,
} from '@/lib/api';

export default function StudentThreadPage() {
  const { user, accessToken, loading } = useAuth();
  const router = useRouter();

  const [entries, setEntries] = useState<ThreadEntry[]>([]);
  const [loadingData, setLoadingData] = useState(true);
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);

  // Input state
  const [inputMode, setInputMode] = useState<'text' | 'link' | 'file' | 'audio'>('text');
  const [textContent, setTextContent] = useState('');
  const [linkUrl, setLinkUrl] = useState('');
  const [linkTitle, setLinkTitle] = useState('');

  // Audio recording
  const [isRecording, setIsRecording] = useState(false);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [recordingTime, setRecordingTime] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!loading && !user) router.push('/login');
    if (!loading && user?.role === 'admin') router.push('/admin');
    if (!loading && user?.mustChangePassword) router.push('/change-password');
  }, [user, loading, router]);

  const fetchThread = useCallback(async () => {
    if (!accessToken || !user) return;
    setLoadingData(true);
    try {
      const data = await getThread(accessToken, user.id);
      setEntries(data.entries);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка загрузки треда');
    } finally {
      setLoadingData(false);
    }
  }, [accessToken, user]);

  useEffect(() => {
    if (accessToken && user?.role === 'student') {
      fetchThread();
    }
  }, [accessToken, user, fetchThread]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [entries]);

  const handleSendText = async () => {
    if (!accessToken || !user || !textContent.trim()) return;
    setSending(true);
    try {
      const { entry } = await addThreadEntry(accessToken, user.id, {
        type: 'text',
        content: textContent.trim(),
      });
      setEntries((prev) => [...prev, entry]);
      setTextContent('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка отправки');
    } finally {
      setSending(false);
    }
  };

  const handleSendLink = async () => {
    if (!accessToken || !user || !linkUrl.trim()) return;
    setSending(true);
    try {
      const content = linkTitle.trim() ? `${linkTitle.trim()}\n${linkUrl.trim()}` : linkUrl.trim();
      const { entry } = await addThreadEntry(accessToken, user.id, {
        type: 'link',
        content,
      });
      setEntries((prev) => [...prev, entry]);
      setLinkUrl('');
      setLinkTitle('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка отправки');
    } finally {
      setSending(false);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !accessToken || !user) return;

    if (file.size > 50 * 1024 * 1024) {
      setError('Файл превышает максимальный размер 50MB');
      return;
    }

    setSending(true);
    try {
      const { entry } = await uploadThreadFile(accessToken, user.id, file, 'file');
      setEntries((prev) => [...prev, entry]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка загрузки файла');
    } finally {
      setSending(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' });
      const chunks: BlobPart[] = [];

      mediaRecorder.ondataavailable = (e) => chunks.push(e.data);
      mediaRecorder.onstop = () => {
        const blob = new Blob(chunks, { type: 'audio/webm' });
        setAudioBlob(blob);
        stream.getTracks().forEach((t) => t.stop());
      };

      mediaRecorderRef.current = mediaRecorder;
      mediaRecorder.start();
      setIsRecording(true);
      setRecordingTime(0);
      timerRef.current = setInterval(() => setRecordingTime((t) => t + 1), 1000);
    } catch {
      setError('Нет доступа к микрофону');
    }
  };

  const stopRecording = () => {
    mediaRecorderRef.current?.stop();
    setIsRecording(false);
    if (timerRef.current) clearInterval(timerRef.current);
  };

  const sendAudio = async () => {
    if (!audioBlob || !accessToken || !user) return;
    setSending(true);
    try {
      const file = new File([audioBlob], `audio-${Date.now()}.webm`, { type: 'audio/webm' });
      const { entry } = await uploadThreadFile(accessToken, user.id, file, 'audio');
      setEntries((prev) => [...prev, entry]);
      setAudioBlob(null);
      setRecordingTime(0);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка загрузки аудио');
    } finally {
      setSending(false);
    }
  };

  const cancelAudio = () => {
    setAudioBlob(null);
    setRecordingTime(0);
  };

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  if (loading) return <p style={{ padding: 32, fontFamily: 'sans-serif' }}>Загрузка...</p>;
  if (!user || user.role !== 'student') return null;

  return (
    <main style={{ padding: 32, fontFamily: 'sans-serif', maxWidth: 800, margin: '0 auto' }}>
      <div style={{ marginBottom: 24 }}>
        <button
          onClick={() => router.push('/dashboard')}
          style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 14, color: '#666', marginBottom: 8, display: 'block' }}
        >
          ← Назад
        </button>
        <h1 style={{ fontSize: 24, fontWeight: 700, margin: 0 }}>Мой тред</h1>
        <p style={{ color: '#666', margin: '4px 0 0' }}>Записи, файлы, обратная связь от преподавателя</p>
      </div>

      {error && (
        <div style={{ padding: '12px 16px', background: '#fee', color: '#c00', borderRadius: 8, marginBottom: 16 }}>
          {error}
          <button onClick={() => setError('')} style={{ float: 'right', background: 'none', border: 'none', cursor: 'pointer', color: '#c00' }}>✕</button>
        </div>
      )}

      {/* Thread entries */}
      <div style={{ border: '1px solid #e0e0e0', borderRadius: 12, padding: 16, minHeight: 300, maxHeight: 500, overflowY: 'auto', marginBottom: 16, background: '#fafafa' }}>
        {loadingData ? (
          <p style={{ color: '#999', textAlign: 'center', paddingTop: 100 }}>Загрузка...</p>
        ) : entries.length === 0 ? (
          <p style={{ color: '#999', textAlign: 'center', paddingTop: 100 }}>
            Тред пуст. Добавьте первую запись!
          </p>
        ) : (
          entries.map((entry) => (
            <EntryCard key={entry.id} entry={entry} currentUserId={user.id} />
          ))
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input area */}
      <div style={{ border: '1px solid #e0e0e0', borderRadius: 12, padding: 16 }}>
        {/* Mode tabs */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          {(['text', 'link', 'file', 'audio'] as const).map((mode) => (
            <button
              key={mode}
              onClick={() => setInputMode(mode)}
              style={{
                padding: '6px 14px',
                borderRadius: 6,
                border: inputMode === mode ? '2px solid #000' : '1px solid #ccc',
                background: inputMode === mode ? '#000' : '#fff',
                color: inputMode === mode ? '#fff' : '#333',
                cursor: 'pointer',
                fontSize: 13,
                fontWeight: 500,
              }}
            >
              {mode === 'text' && 'Текст'}
              {mode === 'link' && 'Ссылка'}
              {mode === 'file' && 'Файл'}
              {mode === 'audio' && 'Аудио'}
            </button>
          ))}
        </div>

        {/* Text input */}
        {inputMode === 'text' && (
          <div style={{ display: 'flex', gap: 8 }}>
            <textarea
              value={textContent}
              onChange={(e) => setTextContent(e.target.value)}
              placeholder="Введите текст..."
              style={{ flex: 1, padding: 10, borderRadius: 8, border: '1px solid #ccc', minHeight: 60, resize: 'vertical', fontFamily: 'inherit', fontSize: 14 }}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSendText(); } }}
            />
            <button
              onClick={handleSendText}
              disabled={sending || !textContent.trim()}
              style={{ padding: '10px 20px', borderRadius: 8, border: 'none', background: '#000', color: '#fff', cursor: 'pointer', alignSelf: 'flex-end', opacity: sending || !textContent.trim() ? 0.5 : 1 }}
            >
              {sending ? '...' : 'Отправить'}
            </button>
          </div>
        )}

        {/* Link input */}
        {inputMode === 'link' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <input
              value={linkUrl}
              onChange={(e) => setLinkUrl(e.target.value)}
              placeholder="https://..."
              style={{ padding: 10, borderRadius: 8, border: '1px solid #ccc', fontSize: 14 }}
            />
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                value={linkTitle}
                onChange={(e) => setLinkTitle(e.target.value)}
                placeholder="Описание (необязательно)"
                style={{ flex: 1, padding: 10, borderRadius: 8, border: '1px solid #ccc', fontSize: 14 }}
              />
              <button
                onClick={handleSendLink}
                disabled={sending || !linkUrl.trim()}
                style={{ padding: '10px 20px', borderRadius: 8, border: 'none', background: '#000', color: '#fff', cursor: 'pointer', opacity: sending || !linkUrl.trim() ? 0.5 : 1 }}
              >
                {sending ? '...' : 'Добавить'}
              </button>
            </div>
          </div>
        )}

        {/* File input */}
        {inputMode === 'file' && (
          <div>
            <input
              ref={fileInputRef}
              type="file"
              onChange={handleFileUpload}
              style={{ display: 'none' }}
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={sending}
              style={{ padding: '12px 24px', borderRadius: 8, border: '2px dashed #ccc', background: '#fff', cursor: 'pointer', width: '100%', fontSize: 14, color: '#666' }}
            >
              {sending ? 'Загрузка...' : 'Выберите файл (до 50MB)'}
            </button>
          </div>
        )}

        {/* Audio input */}
        {inputMode === 'audio' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            {!isRecording && !audioBlob && (
              <button
                onClick={startRecording}
                style={{ padding: '12px 24px', borderRadius: 8, border: 'none', background: '#c00', color: '#fff', cursor: 'pointer', fontSize: 14 }}
              >
                🎙 Начать запись
              </button>
            )}
            {isRecording && (
              <>
                <span style={{ color: '#c00', fontWeight: 600 }}>● Запись {formatTime(recordingTime)}</span>
                <button
                  onClick={stopRecording}
                  style={{ padding: '8px 16px', borderRadius: 8, border: 'none', background: '#333', color: '#fff', cursor: 'pointer', fontSize: 13 }}
                >
                  Остановить
                </button>
              </>
            )}
            {audioBlob && !isRecording && (
              <>
                <span style={{ fontSize: 14, color: '#333' }}>Аудио записано ({formatTime(recordingTime)})</span>
                <button
                  onClick={sendAudio}
                  disabled={sending}
                  style={{ padding: '8px 16px', borderRadius: 8, border: 'none', background: '#000', color: '#fff', cursor: 'pointer', fontSize: 13 }}
                >
                  {sending ? '...' : 'Отправить'}
                </button>
                <button
                  onClick={cancelAudio}
                  style={{ padding: '8px 16px', borderRadius: 8, border: '1px solid #ccc', background: '#fff', cursor: 'pointer', fontSize: 13 }}
                >
                  Отмена
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </main>
  );
}

function EntryCard({ entry, currentUserId }: { entry: ThreadEntry; currentUserId: string }) {
  const isOwn = entry.authorId === currentUserId;
  const isAdmin = entry.author.role === 'admin';
  const date = new Date(entry.createdAt);

  const typeLabels: Record<string, string> = {
    text: '',
    file: '📎',
    audio: '🎵',
    link: '🔗',
    comment: '💬',
    note: '📝',
  };

  const bgColor = isAdmin ? '#eef' : isOwn ? '#fff' : '#f5f5f5';
  const borderColor = isAdmin ? '#99c' : '#e0e0e0';

  return (
    <div
      style={{
        padding: 12,
        marginBottom: 8,
        borderRadius: 8,
        border: `1px solid ${borderColor}`,
        background: bgColor,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: isAdmin ? '#339' : '#333' }}>
          {entry.author.name} {isAdmin && '(преподаватель)'}
        </span>
        <span style={{ fontSize: 11, color: '#999' }}>
          {date.toLocaleDateString('ru-RU')} {date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}
        </span>
      </div>

      <div style={{ fontSize: 14 }}>
        {typeLabels[entry.type] && <span style={{ marginRight: 4 }}>{typeLabels[entry.type]}</span>}

        {entry.type === 'text' || entry.type === 'comment' || entry.type === 'note' ? (
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
            <span>{entry.metadata?.fileName || entry.content}</span>
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
