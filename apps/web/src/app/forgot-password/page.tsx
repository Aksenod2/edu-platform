'use client';

import { useState, type FormEvent } from 'react';
import { AuthLayout } from '@platform/ui/templates';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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

  if (sent) {
    return (
      <AuthLayout
        title="Письмо отправлено"
        subtitle={`Если аккаунт существует, ссылка для сброса отправлена на ${email}`}
      >
        <div className="flex flex-col items-center gap-6">
          <CheckCircle className="w-12 h-12 text-green-500" />
          <a href="/login" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
            ← Вернуться ко входу
          </a>
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      title="Сброс пароля"
      subtitle="Укажите email — мы отправим ссылку для восстановления"
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-5">
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <div className="flex flex-col gap-2">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            placeholder="you@example.com"
            autoComplete="email"
          />
        </div>

        <Button type="submit" className="w-full" disabled={loading}>
          {loading ? 'Отправка...' : 'Отправить ссылку'}
        </Button>

        <div className="text-center">
          <a href="/login" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
            ← Вернуться ко входу
          </a>
        </div>
      </form>
    </AuthLayout>
  );
}
