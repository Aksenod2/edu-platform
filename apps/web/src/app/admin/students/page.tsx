'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import {
  getStudents,
  createStudent,
  updateStudent,
  deleteStudent,
  inviteStudent,
  resetStudentPassword,
  type Student,
} from '@/lib/api';

export default function StudentsPage() {
  const { user, accessToken, loading } = useAuth();
  const router = useRouter();

  const [students, setStudents] = useState<Student[]>([]);
  const [search, setSearch] = useState('');
  const [loadingStudents, setLoadingStudents] = useState(true);
  const [error, setError] = useState('');
  const [actionMessage, setActionMessage] = useState('');

  // Create form
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newEmail, setNewEmail] = useState('');
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (!loading && !user) router.push('/login');
    if (!loading && user && user.role !== 'admin') router.push('/dashboard');
    if (!loading && user?.mustChangePassword) router.push('/change-password');
  }, [user, loading, router]);

  const fetchStudents = useCallback(async () => {
    if (!accessToken) return;
    setLoadingStudents(true);
    try {
      const data = await getStudents(accessToken, search || undefined);
      setStudents(data.users);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка загрузки');
    } finally {
      setLoadingStudents(false);
    }
  }, [accessToken, search]);

  useEffect(() => {
    if (accessToken) fetchStudents();
  }, [accessToken, fetchStudents]);

  const showMessage = (msg: string) => {
    setActionMessage(msg);
    setTimeout(() => setActionMessage(''), 5000);
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!accessToken) return;
    setCreating(true);
    try {
      await createStudent(accessToken, newEmail, newName);
      setNewEmail('');
      setNewName('');
      setShowCreateForm(false);
      showMessage('Ученик создан');
      await fetchStudents();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка создания');
    } finally {
      setCreating(false);
    }
  };

  const handleToggleActive = async (student: Student) => {
    if (!accessToken) return;
    try {
      await updateStudent(accessToken, student.id, { isActive: !student.isActive });
      showMessage(student.isActive ? 'Ученик заблокирован' : 'Ученик разблокирован');
      await fetchStudents();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка');
    }
  };

  const handleDelete = async (student: Student) => {
    if (!accessToken) return;
    if (!confirm(`Удалить ученика ${student.name}?`)) return;
    try {
      await deleteStudent(accessToken, student.id);
      showMessage('Ученик удалён');
      await fetchStudents();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка удаления');
    }
  };

  const handleInvite = async (student: Student) => {
    if (!accessToken) return;
    try {
      const data = await inviteStudent(accessToken, student.id);
      showMessage(`Invite-ссылка: ${data.inviteUrl}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка приглашения');
    }
  };

  const handleResetPassword = async (student: Student) => {
    if (!accessToken) return;
    if (!confirm(`Сбросить пароль для ${student.name}?`)) return;
    try {
      const data = await resetStudentPassword(accessToken, student.id);
      showMessage(`Временный пароль: ${data.tempPassword}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка сброса пароля');
    }
  };

  if (loading) return <p style={{ padding: 32, fontFamily: 'sans-serif' }}>Загрузка...</p>;
  if (!user || user.role !== 'admin') return null;

  return (
    <main style={{ padding: 32, fontFamily: 'sans-serif', maxWidth: 960, margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div>
          <a href="/admin" style={{ color: '#666', textDecoration: 'none', fontSize: 14 }}>&larr; Панель администратора</a>
          <h1 style={{ margin: '8px 0 0' }}>Ученики</h1>
        </div>
        <button
          onClick={() => setShowCreateForm(!showCreateForm)}
          style={{ padding: '8px 16px', background: '#0070f3', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer' }}
        >
          {showCreateForm ? 'Отмена' : 'Создать ученика'}
        </button>
      </div>

      {error && (
        <div style={{ padding: '8px 12px', background: '#fee', color: '#c00', borderRadius: 4, marginBottom: 16 }}>
          {error}
        </div>
      )}

      {actionMessage && (
        <div style={{ padding: '8px 12px', background: '#efe', color: '#060', borderRadius: 4, marginBottom: 16, wordBreak: 'break-all' }}>
          {actionMessage}
        </div>
      )}

      {showCreateForm && (
        <form onSubmit={handleCreate} style={{ padding: 16, background: '#f9f9f9', border: '1px solid #ddd', borderRadius: 6, marginBottom: 16 }}>
          <h3 style={{ margin: '0 0 12px' }}>Новый ученик</h3>
          <div style={{ marginBottom: 8 }}>
            <input
              type="text"
              placeholder="Имя"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              required
              style={{ padding: '6px 10px', border: '1px solid #ccc', borderRadius: 4, width: '100%', boxSizing: 'border-box' }}
            />
          </div>
          <div style={{ marginBottom: 8 }}>
            <input
              type="email"
              placeholder="Email"
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
              required
              style={{ padding: '6px 10px', border: '1px solid #ccc', borderRadius: 4, width: '100%', boxSizing: 'border-box' }}
            />
          </div>
          <button
            type="submit"
            disabled={creating}
            style={{ padding: '8px 16px', background: '#0070f3', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer' }}
          >
            {creating ? 'Создание...' : 'Создать'}
          </button>
        </form>
      )}

      <div style={{ marginBottom: 16 }}>
        <input
          type="text"
          placeholder="Поиск по имени или email..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ padding: '6px 10px', border: '1px solid #ccc', borderRadius: 4, width: '100%', maxWidth: 400, boxSizing: 'border-box' }}
        />
      </div>

      {loadingStudents ? (
        <p>Загрузка...</p>
      ) : students.length === 0 ? (
        <p style={{ color: '#666' }}>Ученики не найдены</p>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '2px solid #ddd', textAlign: 'left' }}>
              <th style={{ padding: '8px 12px' }}>Имя</th>
              <th style={{ padding: '8px 12px' }}>Email</th>
              <th style={{ padding: '8px 12px' }}>Статус</th>
              <th style={{ padding: '8px 12px' }}>Дата создания</th>
              <th style={{ padding: '8px 12px' }}>Действия</th>
            </tr>
          </thead>
          <tbody>
            {students.map((s) => (
              <tr key={s.id} style={{ borderBottom: '1px solid #eee', opacity: s.deletedAt ? 0.5 : 1 }}>
                <td style={{ padding: '8px 12px' }}>{s.name}</td>
                <td style={{ padding: '8px 12px' }}>{s.email}</td>
                <td style={{ padding: '8px 12px' }}>
                  {s.deletedAt ? (
                    <span style={{ color: '#999' }}>Удалён</span>
                  ) : s.isActive ? (
                    <span style={{ color: '#060' }}>Активен</span>
                  ) : (
                    <span style={{ color: '#c00' }}>Заблокирован</span>
                  )}
                </td>
                <td style={{ padding: '8px 12px' }}>{new Date(s.createdAt).toLocaleDateString('ru-RU')}</td>
                <td style={{ padding: '8px 12px' }}>
                  {!s.deletedAt && (
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      <button
                        onClick={() => handleToggleActive(s)}
                        style={{ padding: '4px 8px', fontSize: 12, border: '1px solid #ccc', borderRadius: 3, cursor: 'pointer', background: s.isActive ? '#fee' : '#efe' }}
                      >
                        {s.isActive ? 'Заблокировать' : 'Разблокировать'}
                      </button>
                      <button
                        onClick={() => handleInvite(s)}
                        disabled={!s.isActive}
                        style={{ padding: '4px 8px', fontSize: 12, border: '1px solid #ccc', borderRadius: 3, cursor: 'pointer', background: '#eef' }}
                      >
                        Invite
                      </button>
                      <button
                        onClick={() => handleResetPassword(s)}
                        style={{ padding: '4px 8px', fontSize: 12, border: '1px solid #ccc', borderRadius: 3, cursor: 'pointer', background: '#ffe' }}
                      >
                        Сброс пароля
                      </button>
                      <button
                        onClick={() => handleDelete(s)}
                        style={{ padding: '4px 8px', fontSize: 12, border: '1px solid #c00', color: '#c00', borderRadius: 3, cursor: 'pointer', background: '#fff' }}
                      >
                        Удалить
                      </button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
