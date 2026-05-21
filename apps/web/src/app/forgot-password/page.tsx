'use client';

import { useState, type FormEvent } from 'react';
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
import { forgotPassword } from '@/lib/api';
import { CheckCircle } from 'lucide-react';

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

  return (
    <div className="flex min-h-svh w-full items-center justify-center p-6 md:p-10">
      <div className="w-full max-w-sm">
        <Card>
          {sent ? (
            <>
              <CardHeader>
                <CardTitle>Письмо отправлено</CardTitle>
                <CardDescription>
                  Если аккаунт существует, ссылка для сброса отправлена на {email}
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col items-center gap-6">
                <CheckCircle className="size-12 text-green-500" />
                <a href="/login" className="text-sm underline-offset-4 hover:underline">
                  ← Вернуться ко входу
                </a>
              </CardContent>
            </>
          ) : (
            <>
              <CardHeader>
                <CardTitle>Сброс пароля</CardTitle>
                <CardDescription>
                  Укажите email — мы отправим ссылку для восстановления
                </CardDescription>
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
                      <FieldLabel htmlFor="email">Email</FieldLabel>
                      <Input
                        id="email"
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="you@example.com"
                        autoComplete="email"
                        required
                      />
                    </Field>
                    <Field>
                      <Button type="submit" className="w-full" disabled={loading}>
                        {loading ? 'Отправка...' : 'Отправить ссылку'}
                      </Button>
                    </Field>
                    <a
                      href="/login"
                      className="text-center text-sm underline-offset-4 hover:underline"
                    >
                      ← Вернуться ко входу
                    </a>
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
