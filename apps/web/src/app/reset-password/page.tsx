'use client';

import { Suspense, useState, type FormEvent } from 'react';
import { useSearchParams } from 'next/navigation';
import { AuthLayout } from '@platform/ui/templates';
import { Input, Button, Label } from '@platform/ui/atoms';
import { resetPassword } from '@/lib/api';

function ResetPasswordForm() {
  const searchParams = useSearchParams();
  const token = searchParams.get('token') || '';
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');

    if (password !== confirmPassword) {
      setError('Пароли не совпадают');
      return;
    }
    if (password.length < 6) {
      setError('Пароль должен содержать минимум 6 символов');
      return;
    }

    setLoading(true);
    try {
      await resetPassword(token, password);
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка сброса пароля');
    } finally {
      setLoading(false);
    }
  }

  if (!token) {
    return (
      <AuthLayout title="Невалидная ссылка" subtitle="Ссылка для сброса пароля недействительна или устарела">
        <div style={{ textAlign: 'center' }}>
          <a
            href="/login"
            style={{
              color: 'var(--color-accent-red)',
              textDecoration: 'none',
              fontSize: 'var(--text-sm)',
              fontFamily: 'var(--font-mono)',
              letterSpacing: 'var(--tracking-wide)',
              textTransform: 'uppercase',
            }}
          >
            ← Вернуться ко входу
          </a>
        </div>
      </AuthLayout>
    );
  }

  if (done) {
    return (
      <AuthLayout title="Пароль изменён" subtitle="Вы можете войти с новым паролем">
        <div style={{ textAlign: 'center' }}>
          <div style={{
            width: 48,
            height: 48,
            borderRadius: 'var(--radius-full)',
            border: '2px solid var(--color-success)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            margin: '0 auto var(--space-6)',
            color: 'var(--color-success)',
          }}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20 6L9 17l-5-5" />
            </svg>
          </div>
          <a
            href="/login"
            style={{
              color: 'var(--color-accent-red)',
              textDecoration: 'none',
              fontSize: 'var(--text-sm)',
              fontFamily: 'var(--font-mono)',
              letterSpacing: 'var(--tracking-wide)',
              textTransform: 'uppercase',
            }}
          >
            Войти →
          </a>
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      title="Новый пароль"
      subtitle="Задайте новый пароль для вашего аккаунта"
    >
      <form onSubmit={handleSubmit}>
        {error && (
          <div style={{
            padding: 'var(--space-3) var(--space-4)',
            background: 'var(--color-error-dim)',
            border: '1px solid var(--color-error)',
            borderRadius: 'var(--radius-xs)',
            marginBottom: 'var(--space-5)',
            color: 'var(--color-error)',
            fontSize: 'var(--text-sm)',
            userSelect: 'text',
          }}>
            {error}
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)', marginBottom: 'var(--space-6)' }}>
          <div>
            <Label htmlFor="password" required style={{ marginBottom: 'var(--space-2)', display: 'block' }}>
              Новый пароль
            </Label>
            <Input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={6}
              autoComplete="new-password"
            />
          </div>

          <div>
            <Label htmlFor="confirmPassword" required style={{ marginBottom: 'var(--space-2)', display: 'block' }}>
              Подтвердите пароль
            </Label>
            <Input
              id="confirmPassword"
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
              minLength={6}
              autoComplete="new-password"
              error={!!(confirmPassword && confirmPassword !== password)}
            />
          </div>
        </div>

        <Button
          type="submit"
          variant="primary"
          fullWidth
          loading={loading}
        >
          Сменить пароль
        </Button>
      </form>
    </AuthLayout>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={
      <AuthLayout title="Загрузка...">
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 'var(--space-8)',
        }}>
          <div style={{
            width: 24,
            height: 24,
            borderRadius: '50%',
            border: '2px solid var(--color-border-default)',
            borderTopColor: 'var(--color-accent-red)',
            animation: 'np-spin 0.7s linear infinite',
          }} />
        </div>
      </AuthLayout>
    }>
      <ResetPasswordForm />
    </Suspense>
  );
}
