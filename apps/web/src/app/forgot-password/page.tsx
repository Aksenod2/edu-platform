'use client';

import { useState, type FormEvent } from 'react';
import { AuthLayout } from '@platform/ui/templates';
import { FormField } from '@platform/ui/molecules';
import { Button, Text } from '@platform/ui/atoms';
import { forgotPassword } from '@/lib/api';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await forgotPassword(email);
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка');
    } finally {
      setLoading(false);
    }
  }

  if (sent) {
    return (
      <AuthLayout
        title="Письмо отправлено"
        subtitle={`Если аккаунт существует, ссылка для сброса отправлена на ${email}`}
      >
        <div style={{ textAlign: 'center' }}>
          <div
            style={{
              width: 48,
              height: 48,
              borderRadius: 'var(--radius-full)',
              border: '2px solid var(--color-success)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              margin: '0 auto var(--space-6)',
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
          <BackToLoginLink />
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      title="Сброс пароля"
      subtitle="Укажите email — мы отправим ссылку для восстановления"
    >
      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
        {error && <ErrorAlert message={error} />}

        <FormField
          id="email"
          label="Email"
          required
          inputProps={{
            type: 'email',
            value: email,
            onChange: (e) => setEmail(e.target.value),
            required: true,
            placeholder: 'you@example.com',
            autoComplete: 'email',
          }}
        />

        <Button type="submit" variant="primary" fullWidth loading={loading}>
          {loading ? 'ОТПРАВКА...' : 'ОТПРАВИТЬ ССЫЛКУ'}
        </Button>

        <div style={{ textAlign: 'center' }}>
          <BackToLoginLink />
        </div>
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

function BackToLoginLink() {
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
      ← ВЕРНУТЬСЯ КО ВХОДУ
    </a>
  );
}
