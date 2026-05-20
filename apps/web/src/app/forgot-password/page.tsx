'use client';

import { useState, type FormEvent } from 'react';
import { AuthLayout } from '@platform/ui/templates';
import { Input, Button, Label } from '@platform/ui/atoms';
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
            ← Вернуться ко входу
          </a>
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      title="Сброс пароля"
      subtitle="Укажите email — мы отправим ссылку для восстановления"
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

        <div style={{ marginBottom: 'var(--space-5)' }}>
          <Label htmlFor="email" required style={{ marginBottom: 'var(--space-2)', display: 'block' }}>
            Email
          </Label>
          <Input
            id="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            placeholder="you@example.com"
            autoComplete="email"
          />
        </div>

        <Button
          type="submit"
          variant="primary"
          fullWidth
          loading={loading}
        >
          Отправить ссылку
        </Button>

        <div style={{
          textAlign: 'center',
          marginTop: 'var(--space-5)',
          fontSize: 'var(--text-sm)',
          color: 'var(--color-text-tertiary)',
        }}>
          <a
            href="/login"
            style={{
              color: 'var(--color-text-secondary)',
              textDecoration: 'none',
              fontFamily: 'var(--font-mono)',
              letterSpacing: 'var(--tracking-wide)',
              fontSize: 'var(--text-xs)',
              textTransform: 'uppercase',
            }}
          >
            ← Вернуться ко входу
          </a>
        </div>
      </form>
    </AuthLayout>
  );
}
