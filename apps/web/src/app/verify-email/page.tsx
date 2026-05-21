'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { AuthLayout } from '@platform/ui/templates';
import { Button, Text } from '@platform/ui/atoms';
import { verifyEmail } from '@/lib/api';

type VerifyState = 'loading' | 'success' | 'error' | 'no-token';

function VerifyEmailContent() {
  const searchParams = useSearchParams();
  const token = searchParams.get('token') || '';
  const [state, setState] = useState<VerifyState>(token ? 'loading' : 'no-token');
  const [errorMessage, setErrorMessage] = useState('');

  useEffect(() => {
    if (!token) return;

    verifyEmail(token)
      .then(() => setState('success'))
      .catch((err) => {
        setErrorMessage(err instanceof Error ? err.message : 'Ошибка подтверждения email');
        setState('error');
      });
  }, [token]);

  if (state === 'no-token') {
    return (
      <AuthLayout
        title="Невалидная ссылка"
        subtitle="Ссылка для подтверждения email недействительна или устарела"
      >
        <div style={{ textAlign: 'center' }}>
          <BackToLoginLink />
        </div>
      </AuthLayout>
    );
  }

  if (state === 'loading') {
    return (
      <AuthLayout title="Подтверждение..." subtitle="Проверяем ссылку">
        <PageSpinner />
      </AuthLayout>
    );
  }

  if (state === 'success') {
    return (
      <AuthLayout
        title="Email подтверждён"
        subtitle="Ваш адрес успешно подтверждён. Теперь вы можете войти."
      >
        <div style={{ textAlign: 'center' }}>
          <SuccessIcon />
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
            ВОЙТИ →
          </a>
        </div>
      </AuthLayout>
    );
  }

  // state === 'error'
  return (
    <AuthLayout
      title="Ошибка подтверждения"
      subtitle="Не удалось подтвердить email"
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-5)', alignItems: 'center' }}>
        <div
          style={{
            padding: 'var(--spacing-3) var(--spacing-4)',
            background: 'var(--color-error-dim)',
            border: '1px solid var(--color-error)',
            borderRadius: 'var(--radius-xs)',
            width: '100%',
            userSelect: 'text',
            cursor: 'text',
          }}
        >
          <Text size="sm" color="var(--color-error)">{errorMessage}</Text>
        </div>
        <BackToLoginLink />
      </div>
    </AuthLayout>
  );
}

export default function VerifyEmailPage() {
  return (
    <Suspense
      fallback={
        <AuthLayout title="Загрузка...">
          <PageSpinner />
        </AuthLayout>
      }
    >
      <VerifyEmailContent />
    </Suspense>
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
