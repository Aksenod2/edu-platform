'use client';

import { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { AuthLayout } from '@platform/ui/templates';
import { FormField } from '@platform/ui/molecules';
import { Button, Text } from '@platform/ui/atoms';
import { acceptInvite } from '@/lib/api';

function InviteForm() {
  const searchParams = useSearchParams();
  const token = searchParams.get('token') || '';

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (password.length < 6) {
      setError('Пароль должен быть не менее 6 символов');
      return;
    }

    if (password !== confirmPassword) {
      setError('Пароли не совпадают');
      return;
    }

    setLoading(true);
    try {
      await acceptInvite(token, password);
      setSuccess(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка');
    } finally {
      setLoading(false);
    }
  };

  if (!token) {
    return (
      <AuthLayout title="Ошибка" subtitle="Ссылка приглашения недействительна">
        <div style={{ textAlign: 'center' }}>
          <BackToLoginLink />
        </div>
      </AuthLayout>
    );
  }

  if (success) {
    return (
      <AuthLayout title="Готово!" subtitle="Регистрация завершена. Теперь вы можете войти.">
        <div style={{ textAlign: 'center' }}>
          <SuccessIcon />
          <BackToLoginLink label="ПЕРЕЙТИ КО ВХОДУ →" />
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      title="Регистрация"
      subtitle="Установите пароль для входа на платформу"
    >
      <form
        onSubmit={handleSubmit}
        style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-5)' }}
      >
        {error && <ErrorAlert message={error} />}

        <FormField
          id="password"
          label="Пароль"
          required
          inputProps={{
            type: 'password',
            value: password,
            onChange: (e) => setPassword(e.target.value),
            required: true,
            minLength: 6,
            autoComplete: 'new-password',
          }}
        />

        <FormField
          id="confirmPassword"
          label="Подтвердите пароль"
          required
          error={confirmPassword && confirmPassword !== password ? 'Пароли не совпадают' : undefined}
          inputProps={{
            type: 'password',
            value: confirmPassword,
            onChange: (e) => setConfirmPassword(e.target.value),
            required: true,
            minLength: 6,
            autoComplete: 'new-password',
          }}
        />

        <Button type="submit" variant="primary" fullWidth loading={loading} disabled={loading}>
          {loading ? 'РЕГИСТРАЦИЯ...' : 'ЗАРЕГИСТРИРОВАТЬСЯ'}
        </Button>
      </form>
    </AuthLayout>
  );
}

export default function InvitePage() {
  return (
    <Suspense
      fallback={
        <AuthLayout title="Загрузка...">
          <PageSpinner />
        </AuthLayout>
      }
    >
      <InviteForm />
    </Suspense>
  );
}

function ErrorAlert({ message }: { message: string }) {
  return (
    <div
      style={{
        padding: 'var(--spacing-3) var(--spacing-4)',
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

function BackToLoginLink({ label = '← ВЕРНУТЬСЯ КО ВХОДУ' }: { label?: string }) {
  return (
    <a
      href="/login"
      style={{
        fontFamily: 'var(--font-mono)',
        fontSize: 'var(--text-xs)',
        color: 'var(--color-text-tertiary)',
        textDecoration: 'none',
        letterSpacing: 'var(--tracking-wide)',
        textTransform: 'uppercase',
      }}
    >
      {label}
    </a>
  );
}

function SuccessIcon() {
  return (
    <div
      style={{
        width: 48,
        height: 48,
        borderRadius: 'var(--radius-full)',
        border: '2px solid var(--color-success)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        margin: '0 auto var(--spacing-6)',
        color: 'var(--color-success)',
      }}
    >
      <svg
        width="24"
        height="24"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M20 6L9 17l-5-5" />
      </svg>
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
        padding: 'var(--spacing-8)',
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
