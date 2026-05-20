'use client';

import { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { acceptInvite } from '@/lib/api';
import { Button, Input } from '@platform/ui/atoms';
import { AuthLayout } from '@platform/ui/templates';

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
      <AuthLayout title="Ошибка">
        <p style={{ color: 'var(--color-accent-red)' }}>Ссылка приглашения невалидна.</p>
      </AuthLayout>
    );
  }

  if (success) {
    return (
      <AuthLayout title="Готово!">
        <p style={{ color: 'var(--color-text-secondary)', marginBottom: 'var(--space-4)' }}>
          Регистрация завершена. Теперь вы можете войти.
        </p>
        <a href="/login" style={{ color: 'var(--color-accent-red)' }}>Перейти на страницу входа</a>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      title="Регистрация"
      subtitle="Установите пароль для входа на платформу."
    >
      {error && (
        <div style={{ padding: '8px 12px', background: '#fee', color: '#c00', borderRadius: 4, marginBottom: 16, userSelect: 'text', cursor: 'text' }}>
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit}>
        <div style={{ marginBottom: 12 }}>
          <label style={{ display: 'block', marginBottom: 4, fontSize: 14 }}>Пароль</label>
          <Input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={6}
          />
        </div>
        <div style={{ marginBottom: 16 }}>
          <label style={{ display: 'block', marginBottom: 4, fontSize: 14 }}>Подтвердите пароль</label>
          <Input
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            required
            minLength={6}
          />
        </div>
        <Button
          type="submit"
          variant="primary"
          fullWidth
          loading={loading}
          disabled={loading}
        >
          {loading ? 'Регистрация...' : 'Зарегистрироваться'}
        </Button>
      </form>
    </AuthLayout>
  );
}

export default function InvitePage() {
  return (
    <Suspense fallback={
      <AuthLayout>
        <p style={{ color: 'var(--color-text-tertiary)', textAlign: 'center' }}>Загрузка...</p>
      </AuthLayout>
    }>
      <InviteForm />
    </Suspense>
  );
}
