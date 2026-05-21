'use client';

import { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { AuthLayout } from '@platform/ui/templates';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
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

  if (!token) {
    return (
      <AuthLayout title="Ошибка" subtitle="Ссылка приглашения недействительна">
        <div className="text-center">
          <a href="/login" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
            ← Вернуться ко входу
          </a>
        </div>
      </AuthLayout>
    );
  }

  if (success) {
    return (
      <AuthLayout title="Готово!" subtitle="Регистрация завершена. Теперь вы можете войти.">
        <div className="flex flex-col items-center gap-6">
          <CheckCircle className="w-12 h-12 text-green-500" />
          <a href="/login" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
            Перейти ко входу →
          </a>
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title="Регистрация" subtitle="Установите пароль для входа на платформу">
      <form onSubmit={handleSubmit} className="flex flex-col gap-5">
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <div className="flex flex-col gap-2">
          <Label htmlFor="password">Пароль</Label>
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
          {loading ? 'Регистрация...' : 'Зарегистрироваться'}
        </Button>
      </form>
    </AuthLayout>
  );
}

export default function InvitePage() {
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
      <InviteForm />
    </Suspense>
  );
}
