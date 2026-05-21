'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { AuthLayout } from '@platform/ui/templates';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useAuth } from '@/lib/auth-context';
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
      <AuthLayout title="Загрузка...">
        <div className="flex justify-center py-8">
          <div className="w-6 h-6 rounded-full border-2 border-border border-t-primary animate-spin" />
        </div>
      </AuthLayout>
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
      router.push(user!.role === 'admin' ? '/admin' : '/dashboard');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка смены пароля');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthLayout
      title="Смена пароля"
      subtitle={
        user.mustChangePassword
          ? 'Необходимо сменить пароль перед началом работы'
          : 'Введите текущий пароль и задайте новый'
      }
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-5">
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <div className="flex flex-col gap-2">
          <Label htmlFor="currentPassword">Текущий пароль</Label>
          <Input
            id="currentPassword"
            type="password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            required
            autoComplete="current-password"
          />
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="newPassword">Новый пароль</Label>
          <Input
            id="newPassword"
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            required
            minLength={6}
            autoComplete="new-password"
          />
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="confirmPassword">Подтвердите новый пароль</Label>
          <Input
            id="confirmPassword"
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            required
            minLength={6}
            autoComplete="new-password"
            aria-invalid={confirmPassword !== '' && confirmPassword !== newPassword}
          />
        </div>

        <Button type="submit" className="w-full" disabled={submitting}>
          {submitting ? 'Сохранение...' : 'Сменить пароль'}
        </Button>
      </form>
    </AuthLayout>
  );
}
