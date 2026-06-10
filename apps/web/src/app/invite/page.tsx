'use client';

import { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { SiteFooter } from '@/components/site-footer';
import { acceptInvite } from '@/lib/api';
import { CheckCircle } from 'lucide-react';

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

  return (
    <div className="flex min-h-svh w-full flex-col">
      <div className="flex w-full flex-1 items-center justify-center p-6 md:p-10">
        <div className="w-full max-w-sm">
          <Card>
          {!token ? (
            <>
              <CardHeader>
                <CardTitle>Ошибка</CardTitle>
                <CardDescription>Ссылка приглашения недействительна</CardDescription>
              </CardHeader>
              <CardContent className="text-center text-sm">
                <a href="/login" className="underline-offset-4 hover:underline">
                  ← Вернуться ко входу
                </a>
              </CardContent>
            </>
          ) : success ? (
            <>
              <CardHeader>
                <CardTitle>Готово!</CardTitle>
                <CardDescription>
                  Регистрация завершена. Теперь вы можете войти.
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col items-center gap-6">
                <CheckCircle className="size-12 text-success" />
                <a href="/login" className="text-sm underline-offset-4 hover:underline">
                  Перейти ко входу →
                </a>
              </CardContent>
            </>
          ) : (
            <>
              <CardHeader>
                <CardTitle>Регистрация</CardTitle>
                <CardDescription>Установите пароль для входа на платформу</CardDescription>
              </CardHeader>
              <CardContent>
                <form onSubmit={handleSubmit}>
                  <FieldGroup>
                    {error && (
                      <Alert variant="destructive">
                        <AlertDescription>{error}</AlertDescription>
                      </Alert>
                    )}
                    <Field>
                      <FieldLabel htmlFor="password">Пароль</FieldLabel>
                      <Input
                        id="password"
                        type="password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        minLength={6}
                        autoComplete="new-password"
                        required
                      />
                    </Field>
                    <Field>
                      <FieldLabel htmlFor="confirmPassword">Подтвердите пароль</FieldLabel>
                      <Input
                        id="confirmPassword"
                        type="password"
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        minLength={6}
                        autoComplete="new-password"
                        aria-invalid={confirmPassword !== '' && confirmPassword !== password}
                        required
                      />
                    </Field>
                    <Field>
                      <Button type="submit" className="w-full" disabled={loading}>
                        {loading ? 'Регистрация...' : 'Зарегистрироваться'}
                      </Button>
                    </Field>
                  </FieldGroup>
                </form>
              </CardContent>
            </>
          )}
          </Card>
        </div>
      </div>
      <SiteFooter />
    </div>
  );
}

export default function InvitePage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-svh w-full items-center justify-center p-6 md:p-10">
          <div className="size-6 animate-spin rounded-full border-2 border-border border-t-primary" />
        </div>
      }
    >
      <InviteForm />
    </Suspense>
  );
}
