'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { AuthLayout } from '@platform/ui/templates';
import { FormField } from '@platform/ui/molecules';
import { Button } from '@platform/ui/atoms';
import { Text } from '@platform/ui/atoms';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { login } = useAuth();
  const router = useRouter();

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const user = await login(email, password);
      if (user.mustChangePassword) {
        router.push('/change-password');
      } else if (user.role === 'admin') {
        router.push('/admin');
      } else {
        router.push('/dashboard');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка входа');
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthLayout title="Вход" subtitle="Введите свои данные для доступа">
      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-5)' }}>
        {error && (
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
            <Text size="sm" color="var(--color-error)">{error}</Text>
          </div>
        )}

        <FormField
          id="email"
          label="Email"
          inputProps={{
            type: 'email',
            value: email,
            onChange: (e) => setEmail(e.target.value),
            required: true,
            placeholder: 'name@example.com',
            autoComplete: 'email',
          }}
        />

        <div>
          <FormField
            id="password"
            label="Пароль"
            inputProps={{
              type: 'password',
              value: password,
              onChange: (e) => setPassword(e.target.value),
              required: true,
              placeholder: '••••••••',
              autoComplete: 'current-password',
            }}
          />
          <div style={{ marginTop: 'var(--spacing-2)', textAlign: 'right' }}>
            <a
              href="/forgot-password"
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 'var(--text-xs)',
                color: 'var(--color-text-tertiary)',
                textDecoration: 'none',
                letterSpacing: 'var(--tracking-wide)',
              }}
            >
              ЗАБЫЛИ ПАРОЛЬ
            </a>
          </div>
        </div>

        <Button
          type="submit"
          variant="primary"
          size="lg"
          fullWidth
          loading={loading}
        >
          {loading ? 'ВХОД...' : 'ВОЙТИ'}
        </Button>
      </form>
    </AuthLayout>
  );
}
