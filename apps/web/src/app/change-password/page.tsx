'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
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
import { needsConsents, useAuth } from '@/lib/auth-context';
import { changePassword } from '@/lib/api';

export default function ChangePasswordPage() {
  const { user, accessToken, loading, setAccessToken, setUser } = useAuth();
  const router = useRouter();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  if (loading) {
    return (
      <div className="flex min-h-svh w-full items-center justify-center p-6 md:p-10">
        <div className="size-6 animate-spin rounded-full border-2 border-border border-t-primary" />
      </div>
    );
  }

  if (!user || !accessToken) {
    router.push('/login');
    return null;
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');

    if (newPassword !== confirmPassword) {
      setError('Пароли не совпадают');
      return;
    }
    if (newPassword.length < 6) {
      setError('Новый пароль должен содержать минимум 6 символов');
      return;
    }

    setSubmitting(true);
    try {
      const result = await changePassword(accessToken!, currentPassword, newPassword);
      setAccessToken(result.accessToken);
      setUser({ ...user!, mustChangePassword: false });
      // Пароль сменён, но у студента может остаться долг по обязательным согласиям.
      if (needsConsents(user)) {
        router.push('/consents');
      } else {
        router.push(user!.role === 'admin' ? '/admin' : '/dashboard');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка смены пароля');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-svh w-full items-center justify-center p-6 md:p-10">
      <div className="w-full max-w-sm">
        <Card>
          <CardHeader>
            <CardTitle>Смена пароля</CardTitle>
            <CardDescription>
              {user.mustChangePassword
                ? 'Необходимо сменить пароль перед началом работы'
                : 'Введите текущий пароль и задайте новый'}
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
                  <FieldLabel htmlFor="currentPassword">Текущий пароль</FieldLabel>
                  <Input
                    id="currentPassword"
                    type="password"
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                    autoComplete="current-password"
                    required
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="newPassword">Новый пароль</FieldLabel>
                  <Input
                    id="newPassword"
                    type="password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    minLength={6}
                    autoComplete="new-password"
                    required
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="confirmPassword">Подтвердите новый пароль</FieldLabel>
                  <Input
                    id="confirmPassword"
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    minLength={6}
                    autoComplete="new-password"
                    aria-invalid={confirmPassword !== '' && confirmPassword !== newPassword}
                    required
                  />
                </Field>
                <Field>
                  <Button type="submit" className="w-full" disabled={submitting}>
                    {submitting ? 'Сохранение...' : 'Сменить пароль'}
                  </Button>
                </Field>
              </FieldGroup>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
