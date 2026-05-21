'use client';

import { Suspense, useState, type FormEvent } from 'react';
import { useSearchParams } from 'next/navigation';
import { AuthLayout } from '@platform/ui/templates';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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

  if (!token) {
    return (
      <AuthLayout
        title="Невалидная ссылка"
        subtitle="Ссылка для сброса пароля недействительна или устарела"
      >
        <div className="text-center">
          <a href="/login" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
            ← Вернуться ко входу
          </a>
        </div>
      </AuthLayout>
    );
  }

  if (done) {
    return (
      <AuthLayout title="Пароль изменён" subtitle="Вы можете войти с новым паролем">
        <div className="flex flex-col items-center gap-6">
          <CheckCircle className="w-12 h-12 text-green-500" />
          <a href="/login" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
            Войти →
          </a>
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title="Новый пароль" subtitle="Задайте новый пароль для вашего аккаунта">
      <form onSubmit={handleSubmit} className="flex flex-col gap-5">
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <div className="flex flex-col gap-2">
          <Label htmlFor="password">Новый пароль</Label>
          <Input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={6}
            autoComplete="new-password"
          />
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="confirmPassword">Подтвердите пароль</Label>
          <Input
            id="confirmPassword"
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            required
            minLength={6}
            autoComplete="new-password"
            aria-invalid={confirmPassword !== '' && confirmPassword !== password}
          />
        </div>

        <Button type="submit" className="w-full" disabled={loading}>
          {loading ? 'Сохранение...' : 'Сменить пароль'}
        </Button>
      </form>
    </AuthLayout>
  );
}

export default function ResetPasswordPage() {
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
      <ResetPasswordForm />
    </Suspense>
  );
}
