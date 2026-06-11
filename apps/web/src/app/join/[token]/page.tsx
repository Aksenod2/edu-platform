'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Eye, EyeOff, Loader2 } from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
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
import {
  ConsentCheckboxes,
  EMPTY_CONSENTS,
  consentsToList,
  requiredConsentsGiven,
  type ConsentValues,
} from '@/components/consent-checkboxes';
import { getPublicJoinStream, joinStreamByToken } from '@/lib/api';
import { PHONE_FORMAT_ERROR, PHONE_HINT, isValidPhone, normalizePhone } from '@/lib/phone';

const MIN_PASSWORD_LENGTH = 6;

export default function JoinStreamPage() {
  const params = useParams();
  const router = useRouter();
  const token = (params.token as string) || '';
  const { setUser, setAccessToken } = useAuth();

  // Превью потока по токену: загрузка → имя/закрыт, либо недействительная ссылка.
  const [previewLoading, setPreviewLoading] = useState(true);
  const [streamName, setStreamName] = useState<string | null>(null);
  const [streamClosed, setStreamClosed] = useState(false);
  const [invalid, setInvalid] = useState(false);

  // Поля формы регистрации.
  const [name, setName] = useState('');
  const [lastName, setLastName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  // Юридические согласия: без обязательных (REQUIRED_CONSENT_TYPES) кнопка регистрации заблокирована.
  const [consents, setConsents] = useState<ConsentValues>(EMPTY_CONSENTS);

  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!token) {
      setInvalid(true);
      setPreviewLoading(false);
      return;
    }
    let cancelled = false;
    getPublicJoinStream(token)
      .then(({ stream }) => {
        if (cancelled) return;
        setStreamName(stream.name);
        setStreamClosed(stream.closed);
      })
      .catch(() => {
        if (!cancelled) setInvalid(true);
      })
      .finally(() => {
        if (!cancelled) setPreviewLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');

    const normalizedPhone = normalizePhone(phone);
    if (!isValidPhone(normalizedPhone)) {
      setError(PHONE_FORMAT_ERROR);
      return;
    }
    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(`Пароль должен быть не менее ${MIN_PASSWORD_LENGTH} символов`);
      return;
    }
    if (password !== confirmPassword) {
      setError('Пароли не совпадают');
      return;
    }

    setSubmitting(true);
    try {
      const data = await joinStreamByToken(token, {
        email: email.trim(),
        name: name.trim(),
        lastName: lastName.trim(),
        phone: normalizedPhone,
        password,
        consents: consentsToList(consents),
      });
      // Сервер уже выдал сессию (refresh-cookie) и accessToken — логиним сразу.
      setAccessToken(data.accessToken);
      setUser(data.user);
      router.replace('/dashboard');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка регистрации');
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-svh w-full flex-col">
      <div className="flex w-full flex-1 items-center justify-center p-6 md:p-10">
        <div className="w-full max-w-sm">
          <Card>
          {previewLoading ? (
            <CardContent className="flex justify-center py-12">
              <Loader2 className="size-6 animate-spin text-muted-foreground" />
            </CardContent>
          ) : invalid ? (
            <>
              <CardHeader>
                <CardTitle>Ссылка недействительна</CardTitle>
                <CardDescription>
                  Приглашение не найдено или было отозвано. Попросите новую ссылку.
                </CardDescription>
              </CardHeader>
              <CardContent className="text-center text-sm">
                <a href="/login" className="underline-offset-4 hover:underline">
                  ← Вернуться ко входу
                </a>
              </CardContent>
            </>
          ) : streamClosed ? (
            <>
              <CardHeader>
                <CardTitle>Набор закрыт</CardTitle>
                <CardDescription>
                  Набор в группу «{streamName}» сейчас закрыт.
                </CardDescription>
              </CardHeader>
              <CardContent className="text-center text-sm">
                <a href="/login" className="underline-offset-4 hover:underline">
                  ← Вернуться ко входу
                </a>
              </CardContent>
            </>
          ) : (
            <>
              <CardHeader>
                <CardTitle>Регистрация в группу</CardTitle>
                <CardDescription>
                  Вы вступаете в группу «{streamName}». Заполните данные — после
                  регистрации вы сразу попадёте на платформу.
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
                      <FieldLabel htmlFor="name">Имя</FieldLabel>
                      <Input
                        id="name"
                        type="text"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder="Иван"
                        autoComplete="given-name"
                        required
                      />
                    </Field>
                    <Field>
                      <FieldLabel htmlFor="lastName">Фамилия</FieldLabel>
                      <Input
                        id="lastName"
                        type="text"
                        value={lastName}
                        onChange={(e) => setLastName(e.target.value)}
                        placeholder="Иванов"
                        autoComplete="family-name"
                        required
                      />
                    </Field>
                    <Field>
                      <FieldLabel htmlFor="phone">Телефон</FieldLabel>
                      <Input
                        id="phone"
                        type="tel"
                        value={phone}
                        onChange={(e) => setPhone(e.target.value)}
                        placeholder="+79991234567"
                        autoComplete="tel"
                        required
                      />
                      <p className="text-xs text-muted-foreground">{PHONE_HINT}</p>
                    </Field>
                    <Field>
                      <FieldLabel htmlFor="email">Email</FieldLabel>
                      <Input
                        id="email"
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="name@example.com"
                        autoComplete="email"
                        required
                      />
                    </Field>
                    <Field>
                      <FieldLabel htmlFor="password">Пароль</FieldLabel>
                      <div className="relative">
                        <Input
                          id="password"
                          type={showPassword ? 'text' : 'password'}
                          value={password}
                          onChange={(e) => setPassword(e.target.value)}
                          minLength={MIN_PASSWORD_LENGTH}
                          autoComplete="new-password"
                          required
                          className="pr-10"
                        />
                        <button
                          type="button"
                          onClick={() => setShowPassword((v) => !v)}
                          aria-label={showPassword ? 'Скрыть пароль' : 'Показать пароль'}
                          aria-pressed={showPassword}
                          tabIndex={-1}
                          className="absolute inset-y-0 right-0 flex w-10 cursor-pointer items-center justify-center text-muted-foreground hover:text-foreground"
                        >
                          {showPassword ? (
                            <EyeOff className="size-4" />
                          ) : (
                            <Eye className="size-4" />
                          )}
                        </button>
                      </div>
                    </Field>
                    <Field>
                      <FieldLabel htmlFor="confirmPassword">Подтвердите пароль</FieldLabel>
                      <Input
                        id="confirmPassword"
                        type={showPassword ? 'text' : 'password'}
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        minLength={MIN_PASSWORD_LENGTH}
                        autoComplete="new-password"
                        aria-invalid={confirmPassword !== '' && confirmPassword !== password}
                        required
                      />
                    </Field>
                    <ConsentCheckboxes values={consents} onChange={setConsents} />
                    <Field>
                      <Button
                        type="submit"
                        className="w-full"
                        disabled={submitting || !requiredConsentsGiven(consents)}
                      >
                        {submitting ? 'Регистрация...' : 'Зарегистрироваться'}
                      </Button>
                    </Field>
                    <p className="text-center text-sm text-muted-foreground">
                      Уже есть аккаунт?{' '}
                      <a href="/login" className="text-foreground underline-offset-4 hover:underline">
                        Войти
                      </a>
                    </p>
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
