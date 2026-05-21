'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { AuthLayout } from '@platform/ui/templates';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { CheckCircle } from 'lucide-react';
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
        <div className="text-center">
          <a href="/login" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
            ← Вернуться ко входу
          </a>
        </div>
      </AuthLayout>
    );
  }

  if (state === 'loading') {
    return (
      <AuthLayout title="Подтверждение..." subtitle="Проверяем ссылку">
        <div className="flex justify-center py-8">
          <div className="w-6 h-6 rounded-full border-2 border-border border-t-primary animate-spin" />
        </div>
      </AuthLayout>
    );
  }

  if (state === 'success') {
    return (
      <AuthLayout
        title="Email подтверждён"
        subtitle="Ваш адрес успешно подтверждён. Теперь вы можете войти."
      >
        <div className="flex flex-col items-center gap-6">
          <CheckCircle className="w-12 h-12 text-green-500" />
          <a href="/login" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
            Войти →
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
      <div className="flex flex-col items-center gap-5">
        <Alert variant="destructive" className="w-full">
          <AlertDescription>{errorMessage}</AlertDescription>
        </Alert>
        <a href="/login" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
          ← Вернуться ко входу
        </a>
      </div>
    </AuthLayout>
  );
}

export default function VerifyEmailPage() {
  return (
    <Suspense
      fallback={
        <AuthLayout title="Загрузка...">
          <div className="flex justify-center py-8">
            <div className="w-6 h-6 rounded-full border-2 border-border border-t-primary animate-spin" />
          </div>
        </AuthLayout>
      }
    >
      <VerifyEmailContent />
    </Suspense>
  );
}
