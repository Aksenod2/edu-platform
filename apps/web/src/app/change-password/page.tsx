'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { AuthLayout } from '@platform/ui/templates';
import { FormField } from '@platform/ui/molecules';
import { Button, Text } from '@platform/ui/atoms';
import { useAuth } from '@/lib/auth-context';
import { changePassword } from '@/lib/api';

export default function ChangePasswordPage() {
  const { user, accessToken, loading, setAccessToken, setUser } = useAuth();
  const router = useRouter();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  if (loading) {
    return (
      <AuthLayout title="Загрузка...">
        <PageSpinner />
      </AuthLayout>
    );
  }

  if (!user || !accessToken) {
    router.push('/login');
    return null;
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');

    if (newPassword !== confirmPassword) {
      setError('Пароли не совпадают');
      return;
    }
    if (newPassword.length < 6) {
      setError('Новый пароль должен содержать минимум 6 символов');
      return;
    }

    setSubmitting(true);
    try {
      const result = await changePassword(accessToken!, currentPassword, newPassword);
      setAccessToken(result.accessToken);
      setUser({ ...user!, mustChangePassword: false });
      router.push(user!.role === 'admin' ? '/admin' : '/dashboard');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка смены пароля');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthLayout
      title="Смена пароля"
      subtitle={
        user.mustChangePassword
          ? 'Необходимо сменить пароль перед началом работы'
          : 'Введите текущий пароль и задайте новый'
      }
    >
      <form
        onSubmit={handleSubmit}
        style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}
      >
        {error && <ErrorAlert message={error} />}

        <FormField
          id="currentPassword"
          label="Текущий пароль"
          required
          inputProps={{
            type: 'password',
            value: currentPassword,
            onChange: (e) => setCurrentPassword(e.target.value),
            required: true,
            autoComplete: 'current-password',
          }}
        />

        <FormField
          id="newPassword"
          label="Новый пароль"
          required
          inputProps={{
            type: 'password',
            value: newPassword,
            onChange: (e) => setNewPassword(e.target.value),
            required: true,
            minLength: 6,
            autoComplete: 'new-password',
          }}
        />

        <FormField
          id="confirmPassword"
          label="Подтвердите новый пароль"
          required
          error={confirmPassword && confirmPassword !== newPassword ? 'Пароли не совпадают' : undefined}
          inputProps={{
            type: 'password',
            value: confirmPassword,
            onChange: (e) => setConfirmPassword(e.target.value),
            required: true,
            minLength: 6,
            autoComplete: 'new-password',
          }}
        />

        <Button type="submit" variant="primary" fullWidth loading={submitting}>
          {submitting ? 'СОХРАНЕНИЕ...' : 'СМЕНИТЬ ПАРОЛЬ'}
        </Button>
      </form>
    </AuthLayout>
  );
}

function ErrorAlert({ message }: { message: string }) {
  return (
    <div
      style={{
        padding: 'var(--space-3) var(--space-4)',
        background: 'var(--color-error-dim)',
        border: '1px solid var(--color-error)',
        borderRadius: 'var(--radius-xs)',
        userSelect: 'text',
        cursor: 'text',
      }}
    >
      <Text size="sm" color="var(--color-error)">{message}</Text>
    </div>
  );
}

function PageSpinner() {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 'var(--space-8)',
      }}
    >
      <div
        style={{
          width: 24,
          height: 24,
          borderRadius: '50%',
          border: '2px solid var(--color-border-default)',
          borderTopColor: 'var(--color-accent-red)',
          animation: 'np-spin 0.7s linear infinite',
        }}
      />
    </div>
  );
}
