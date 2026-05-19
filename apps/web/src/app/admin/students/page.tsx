'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter, usePathname } from 'next/navigation';
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
import { DashboardLayout, PageHeader } from '@platform/ui/templates';
import { Card, FormField } from '@platform/ui/molecules';
import { Button, Input, Badge, Heading, Text, Mono, Spinner } from '@platform/ui/atoms';

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

export default function StudentsPage() {
  const { user, accessToken, loading, logout } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  const [students, setStudents] = useState<Student[]>([]);
  const [search, setSearch] = useState('');
  const [loadingStudents, setLoadingStudents] = useState(true);
  const [error, setError] = useState('');
  const [actionMessage, setActionMessage] = useState('');

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
      <PageHeader
        title="Ученики"
        subtitle="Управление учениками"
        action={
          <Button
            variant={showCreateForm ? 'ghost' : 'primary'}
            size="sm"
            onClick={() => setShowCreateForm(!showCreateForm)}
          >
            {showCreateForm ? 'Отмена' : 'Создать ученика'}
          </Button>
        }
      />

      {error && (
        <Card variant="outlined" padding="sm" style={{ borderColor: 'var(--color-error)', marginBottom: 'var(--space-4)' }}>
          <Text size="sm" color="var(--color-error)">{error}</Text>
        </Card>
      )}

      {actionMessage && (
        <Card variant="outlined" padding="sm" style={{ borderColor: 'var(--color-success)', marginBottom: 'var(--space-4)' }}>
          <Mono size="xs" style={{ wordBreak: 'break-all', color: 'var(--color-success)' }}>{actionMessage}</Mono>
        </Card>
      )}

      {showCreateForm && (
        <Card variant="elevated" padding="md" style={{ marginBottom: 'var(--space-6)' }}>
          <Heading level={3} size="lg" style={{ marginBottom: 'var(--space-4)' }}>Новый ученик</Heading>
          <form onSubmit={handleCreate}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)', marginBottom: 'var(--space-4)' }}>
              <FormField id="new-name" label="Имя" required inputProps={{ placeholder: 'Имя', value: newName, onChange: (e: React.ChangeEvent<HTMLInputElement>) => setNewName(e.target.value) }} />
              <FormField id="new-email" label="Email" required inputProps={{ type: 'email', placeholder: 'Email', value: newEmail, onChange: (e: React.ChangeEvent<HTMLInputElement>) => setNewEmail(e.target.value) }} />
            </div>
            <Button type="submit" variant="primary" size="sm" loading={creating}>
              Создать
            </Button>
          </form>
        </Card>
      )}

      <div style={{ marginBottom: 'var(--space-4)' }}>
        <Input
          placeholder="Поиск по имени или email..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          leftElement={<SearchIcon />}
          style={{ maxWidth: 400 }}
        />
      </div>

      {loadingStudents ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 'var(--space-8)' }}>
          <Spinner size="md" />
        </div>
      ) : students.length === 0 ? (
        <Text color="tertiary">Ученики не найдены</Text>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{
            width: '100%',
            borderCollapse: 'collapse',
            fontFamily: 'var(--font-sans)',
            fontSize: 'var(--text-sm)',
          }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--color-border-strong)' }}>
                {['Имя', 'Email', 'Статус', 'Создан', 'Действия'].map((h) => (
                  <th key={h} style={{ padding: 'var(--space-3) var(--space-4)', textAlign: 'left', color: 'var(--color-text-tertiary)', fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', textTransform: 'uppercase', letterSpacing: 'var(--tracking-wider)' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {students.map((s) => (
                <tr key={s.id} style={{ borderBottom: '1px solid var(--color-border-subtle)', opacity: s.deletedAt ? 0.4 : 1 }}>
                  <td style={{ padding: 'var(--space-3) var(--space-4)', color: 'var(--color-text-primary)' }}>{s.name}</td>
                  <td style={{ padding: 'var(--space-3) var(--space-4)' }}>
                    <Mono size="xs">{s.email}</Mono>
                  </td>
                  <td style={{ padding: 'var(--space-3) var(--space-4)' }}>
                    {s.deletedAt ? (
                      <Badge variant="default">Удалён</Badge>
                    ) : s.isActive ? (
                      <Badge variant="success">Активен</Badge>
                    ) : (
                      <Badge variant="error">Заблокирован</Badge>
                    )}
                  </td>
                  <td style={{ padding: 'var(--space-3) var(--space-4)' }}>
                    <Mono size="xs" color="var(--color-text-tertiary)">
                      {new Date(s.createdAt).toLocaleDateString('ru-RU')}
                    </Mono>
                  </td>
                  <td style={{ padding: 'var(--space-3) var(--space-4)' }}>
                    {!s.deletedAt && (
                      <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
                        <a href={`/admin/students/${s.id}`} style={{ textDecoration: 'none' }}>
                          <Button variant="ghost" size="sm">Профиль</Button>
                        </a>
                        <a href={`/admin/students/${s.id}/thread`} style={{ textDecoration: 'none' }}>
                          <Button variant="ghost" size="sm">Тред</Button>
                        </a>
                        <Button
                          variant={s.isActive ? 'danger' : 'secondary'}
                          size="sm"
                          onClick={() => handleToggleActive(s)}
                        >
                          {s.isActive ? 'Блокировать' : 'Разблокировать'}
                        </Button>
                        <Button variant="secondary" size="sm" onClick={() => handleInvite(s)} disabled={!s.isActive}>
                          Invite
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => handleResetPassword(s)}>
                          Сброс пароля
                        </Button>
                        <Button variant="danger" size="sm" onClick={() => handleDelete(s)}>
                          Удалить
                        </Button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </DashboardLayout>
  );
}

// ─── Inline icons ─────────────────────────────────────
function GridIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="1" y="1" width="5" height="5" /><rect x="10" y="1" width="5" height="5" /><rect x="1" y="10" width="5" height="5" /><rect x="10" y="10" width="5" height="5" />
    </svg>
  );
}
function UsersIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <circle cx="6" cy="5" r="3" /><path d="M1 14c0-3 2-5 5-5s5 2 5 5" /><circle cx="12" cy="4" r="2" /><path d="M15 13c0-2-1-4-3-4" />
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
function SearchIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <circle cx="7" cy="7" r="4" /><path d="M10 10l4 4" />
    </svg>
  );
}
