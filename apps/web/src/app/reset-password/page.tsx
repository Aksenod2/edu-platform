'use client';

import { Suspense, useState, type FormEvent } from 'react';
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
import { resetPassword } from '@/lib/api';
import { CheckCircle } from 'lucide-react';

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

  return (
    <div className="flex min-h-svh w-full items-center justify-center p-6 md:p-10">
      <div className="w-full max-w-sm">
        <Card>
          {!token ? (
            <>
              <CardHeader>
                <CardTitle>Невалидная ссылка</CardTitle>
                <CardDescription>
                  Ссылка для сброса пароля недействительна или устарела
                </CardDescription>
              </CardHeader>
              <CardContent className="text-center text-sm">
                <a href="/login" className="underline-offset-4 hover:underline">
                  ← Вернуться ко входу
                </a>
              </CardContent>
            </>
          ) : done ? (
            <>
              <CardHeader>
                <CardTitle>Пароль изменён</CardTitle>
                <CardDescription>Вы можете войти с новым паролем</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col items-center gap-6">
                <CheckCircle className="size-12 text-success" />
                <a href="/login" className="text-sm underline-offset-4 hover:underline">
                  Войти →
                </a>
              </CardContent>
            </>
          ) : (
            <>
              <CardHeader>
                <CardTitle>Новый пароль</CardTitle>
                <CardDescription>Задайте новый пароль для вашего аккаунта</CardDescription>
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
                      <FieldLabel htmlFor="password">Новый пароль</FieldLabel>
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
                        {loading ? 'Сохранение...' : 'Сменить пароль'}
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
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-svh w-full items-center justify-center p-6 md:p-10">
          <div className="size-6 animate-spin rounded-full border-2 border-border border-t-primary" />
        </div>
      }
    >
      <ResetPasswordForm />
    </Suspense>
  );
}
