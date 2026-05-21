'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { NotificationBell } from '@/lib/notification-bell';
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
import { Card, CardHeader, CardBody, FormField } from '@platform/ui/molecules';
import { Button, Input, Badge, Heading, Mono, Spinner } from '@platform/ui/atoms';

const ADMIN_NAV = [
  {
    label: 'Управление',
    items: [
      { label: 'Обзор',       href: '/admin',                icon: <GridIcon /> },
      { label: 'Ученики',     href: '/admin/students',       icon: <UsersIcon /> },
      { label: 'Потоки',      href: '/admin/streams',        icon: <StreamIcon /> },
      { label: 'Расписание',  href: '/admin/schedule',       icon: <CalendarIcon /> },
      { label: 'Уведомления', href: '/admin/notifications',  icon: <BellNavIcon /> },
      { label: 'API-доступ',  href: '/admin/api-access',     icon: <KeyIcon /> },
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
      <div className="flex items-center justify-center min-h-screen">
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
        notificationBell: <NotificationBell />,
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
        <div className="mb-4 px-4 py-3 rounded-xs border border-error bg-error-dim">
          <Mono size="xs" className="text-error break-all">{error}</Mono>
        </div>
      )}

      {actionMessage && (
        <div className="mb-4 px-4 py-3 rounded-xs border border-success bg-success-dim">
          <Mono size="xs" className="text-success break-all">{actionMessage}</Mono>
        </div>
      )}

      {showCreateForm && (
        <Card variant="elevated" padding="md" className="mb-6">
          <CardHeader>
            <Heading level={3} size="lg">Новый ученик</Heading>
          </CardHeader>
          <CardBody>
            <form onSubmit={handleCreate}>
              <div className="flex flex-col gap-3 mb-4">
                <FormField
                  id="new-name"
                  label="Имя"
                  required
                  inputProps={{
                    placeholder: 'Имя',
                    value: newName,
                    onChange: (e: React.ChangeEvent<HTMLInputElement>) => setNewName(e.target.value),
                  }}
                />
                <FormField
                  id="new-email"
                  label="Email"
                  required
                  inputProps={{
                    type: 'email',
                    placeholder: 'Email',
                    value: newEmail,
                    onChange: (e: React.ChangeEvent<HTMLInputElement>) => setNewEmail(e.target.value),
                  }}
                />
              </div>
              <Button type="submit" variant="primary" size="sm" loading={creating}>
                Создать
              </Button>
            </form>
          </CardBody>
        </Card>
      )}

      <div className="mb-4">
        <Input
          placeholder="Поиск по имени или email..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          leftElement={<SearchIcon />}
          className="max-w-[400px]"
        />
      </div>

      {loadingStudents ? (
        <div className="flex justify-center py-8">
          <Spinner size="md" />
        </div>
      ) : students.length === 0 ? (
        <Mono size="sm" className="text-text-tertiary">Ученики не найдены</Mono>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse font-sans text-sm">
            <thead>
              <tr className="border-b border-border-strong">
                {['Имя', 'Email', 'Статус', 'Создан', 'Действия'].map((h) => (
                  <th
                    key={h}
                    className="px-4 py-3 text-left font-mono text-xs uppercase tracking-wider text-text-tertiary"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {students.map((s) => (
                <tr
                  key={s.id}
                  className={`border-b border-border-subtle transition-colors hover:bg-bg-surface ${s.deletedAt ? 'opacity-40' : ''}`}
                >
                  <td className="px-4 py-3 text-text-primary">
                    <span className="flex items-center gap-2">
                      {s.name}
                      {!!s.submittedCount && s.submittedCount > 0 && (
                        <Badge variant="warning">
                          {s.submittedCount} ждут проверки
                        </Badge>
                      )}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <Mono size="xs">{s.email}</Mono>
                  </td>
                  <td className="px-4 py-3">
                    {s.deletedAt ? (
                      <Badge variant="default">Удалён</Badge>
                    ) : s.isActive ? (
                      <Badge variant="success">Активен</Badge>
                    ) : (
                      <Badge variant="error">Заблокирован</Badge>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <Mono size="xs" className="text-text-tertiary">
                      {new Date(s.createdAt).toLocaleDateString('ru-RU')}
                    </Mono>
                  </td>
                  <td className="px-4 py-3">
                    {!s.deletedAt && (
                      <div className="flex flex-wrap gap-2">
                        <a href={`/admin/students/${s.id}`} className="no-underline">
                          <Button variant="ghost" size="sm">Профиль</Button>
                        </a>
                        <a href={`/admin/students/${s.id}/thread`} className="no-underline">
                          <Button variant="ghost" size="sm">Тред</Button>
                        </a>
                        <Button
                          variant={s.isActive ? 'danger' : 'secondary'}
                          size="sm"
                          onClick={() => handleToggleActive(s)}
                        >
                          {s.isActive ? 'Блокировать' : 'Разблокировать'}
                        </Button>
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => handleInvite(s)}
                          disabled={!s.isActive}
                        >
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
function SearchIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <circle cx="7" cy="7" r="4" /><path d="M10 10l4 4" />
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
