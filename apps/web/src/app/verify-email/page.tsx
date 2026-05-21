'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
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

  return (
    <div className="flex min-h-svh w-full items-center justify-center p-6 md:p-10">
      <div className="w-full max-w-sm">
        <Card>
          {state === 'no-token' && (
            <>
              <CardHeader>
                <CardTitle>Невалидная ссылка</CardTitle>
                <CardDescription>
                  Ссылка для подтверждения email недействительна или устарела
                </CardDescription>
              </CardHeader>
              <CardContent className="text-center text-sm">
                <a href="/login" className="underline-offset-4 hover:underline">
                  ← Вернуться ко входу
                </a>
              </CardContent>
            </>
          )}

          {state === 'loading' && (
            <>
              <CardHeader>
                <CardTitle>Подтверждение...</CardTitle>
                <CardDescription>Проверяем ссылку</CardDescription>
              </CardHeader>
              <CardContent className="flex justify-center py-4">
                <div className="size-6 animate-spin rounded-full border-2 border-border border-t-primary" />
              </CardContent>
            </>
          )}

          {state === 'success' && (
            <>
              <CardHeader>
                <CardTitle>Email подтверждён</CardTitle>
                <CardDescription>
                  Ваш адрес успешно подтверждён. Теперь вы можете войти.
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col items-center gap-6">
                <CheckCircle className="size-12 text-green-500" />
                <a href="/login" className="text-sm underline-offset-4 hover:underline">
                  Войти →
                </a>
              </CardContent>
            </>
          )}

          {state === 'error' && (
            <>
              <CardHeader>
                <CardTitle>Ошибка подтверждения</CardTitle>
                <CardDescription>Не удалось подтвердить email</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col items-center gap-5">
                <Alert variant="destructive">
                  <AlertDescription>{errorMessage}</AlertDescription>
                </Alert>
                <a href="/login" className="text-sm underline-offset-4 hover:underline">
                  ← Вернуться ко входу
                </a>
              </CardContent>
            </>
          )}
        </Card>
      </div>
    </div>
  );
}

export default function VerifyEmailPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-svh w-full items-center justify-center p-6 md:p-10">
          <div className="size-6 animate-spin rounded-full border-2 border-border border-t-primary" />
        </div>
      }
    >
      <VerifyEmailContent />
    </Suspense>
  );
}
