'use client';

import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  ConsentCheckboxes,
  EMPTY_CONSENTS,
  REQUIRED_CONSENT_TYPES,
  consentsToList,
  requiredConsentsGiven,
  type ConsentValues,
} from '@/components/consent-checkboxes';
import { needsConsents, useAuth } from '@/lib/auth-context';
import { grantMyConsents, type ConsentType } from '@/lib/api';

// Блокирующий гейт для студентов, зарегистрированных ДО появления согласий:
// пока обязательные согласия не даны, в дашборд не пускаем.
export default function ConsentsPage() {
  const { user, accessToken, loading, setUser } = useAuth();
  const router = useRouter();
  const [values, setValues] = useState<ConsentValues>(EMPTY_CONSENTS);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Уже данные обязательные согласия (их нет в pendingConsents) показываем
  // предотмеченными и заблокированными — студент добивает только недостающие.
  // marketing не предотмечаем: его статус с этой страницы не меняется.
  const lockedTypes = useMemo<ConsentType[]>(() => {
    const pending = user?.pendingConsents ?? [];
    return user ? REQUIRED_CONSENT_TYPES.filter((type) => !pending.includes(type)) : [];
  }, [user]);

  useEffect(() => {
    if (lockedTypes.length === 0) return;
    setValues((prev) => {
      const next = { ...prev };
      for (const type of lockedTypes) next[type] = true;
      return next;
    });
  }, [lockedTypes]);

  // Редиректы — side-effect, поэтому в useEffect (а не в теле рендера):
  // незалогиненных — на вход, смена пароля приоритетнее согласий, прямой
  // заход без долга по согласиям (или админом) — в свой кабинет.
  useEffect(() => {
    if (loading) return;
    if (!user || !accessToken) router.push('/login');
    else if (user.mustChangePassword) router.push('/change-password');
    else if (!needsConsents(user)) router.push(user.role === 'admin' ? '/admin' : '/dashboard');
  }, [user, accessToken, loading, router]);

  if (loading || !user || !accessToken || user.mustChangePassword || !needsConsents(user)) {
    return (
      <div className="flex min-h-svh w-full items-center justify-center p-6 md:p-10">
        <div className="size-6 animate-spin rounded-full border-2 border-border border-t-primary" />
      </div>
    );
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      const result = await grantMyConsents(accessToken!, consentsToList(values));
      setUser({ ...user!, pendingConsents: result.pendingConsents });
      if (result.pendingConsents.length === 0) {
        router.push('/dashboard');
      } else {
        // Сервер счёл, что обязательные согласия всё ещё не закрыты.
        setError('Не удалось зафиксировать согласия, попробуйте позже');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка сохранения согласий');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-svh w-full items-center justify-center p-6 md:p-10">
      <div className="w-full max-w-sm">
        <Card>
          <CardHeader>
            <CardTitle>Согласия</CardTitle>
            <CardDescription>
              Мы обновили правовые документы платформы. Для продолжения работы
              примите обязательные согласия. Все документы доступны на странице{' '}
              <a
                href="/legal"
                target="_blank"
                rel="noopener noreferrer"
                className="text-foreground underline underline-offset-4 hover:no-underline"
              >
                правовой информации
              </a>
              .
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="flex flex-col gap-6">
              {error && (
                <Alert variant="destructive">
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}
              <ConsentCheckboxes values={values} onChange={setValues} lockedTypes={lockedTypes} />
              <Button
                type="submit"
                className="w-full"
                disabled={!requiredConsentsGiven(values) || submitting}
              >
                {submitting ? 'Сохранение...' : 'Принять и продолжить'}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
