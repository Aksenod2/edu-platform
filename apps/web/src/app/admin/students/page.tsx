'use client';

import { useEffect, useState, useCallback } from 'react';
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
import { PageHeader } from '@platform/ui/templates';
import { Card, CardHeader, CardBody, FormField } from '@platform/ui/molecules';
import { Button, Input, Badge, Heading, Mono, Spinner } from '@platform/ui/atoms';

export default function StudentsPage() {
  const { accessToken } = useAuth();

  const [students, setStudents] = useState<Student[]>([]);
  const [search, setSearch] = useState('');
  const [loadingStudents, setLoadingStudents] = useState(true);
  const [error, setError] = useState('');
  const [actionMessage, setActionMessage] = useState('');

  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newEmail, setNewEmail] = useState('');
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);

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

  return (
    <>
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
    </>
  );
}

// ─── Inline icons ─────────────────────────────────────
function SearchIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <circle cx="7" cy="7" r="4" /><path d="M10 10l4 4" />
    </svg>
  );
}
