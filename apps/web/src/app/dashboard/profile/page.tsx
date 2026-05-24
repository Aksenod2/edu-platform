'use client';

import { useEffect, useState, useCallback } from 'react';
import { useAuth } from '@/lib/auth-context';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { getProfile, updateProfile, type StudentProfile } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';

export default function ProfilePage() {
  const { user, accessToken, setUser } = useAuth();

  const [profile, setProfile] = useState<StudentProfile | null>(null);
  const [loadingProfile, setLoadingProfile] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const [resume, setResume] = useState('');
  const [contactTelegram, setContactTelegram] = useState('');
  const [direction, setDirection] = useState('');

  const loadProfile = useCallback(async () => {
    if (!accessToken || !user) return;
    try {
      const data = await getProfile(accessToken, user.id);
      setProfile(data.profile);
      if (data.profile) {
        setResume(data.profile.resume || '');
        setContactTelegram(data.profile.contacts?.telegram || '');
        setDirection(data.profile.direction || '');
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Ошибка загрузки профиля');
    } finally {
      setLoadingProfile(false);
    }
  }, [accessToken, user]);

  useEffect(() => {
    if (accessToken && user) loadProfile();
  }, [accessToken, user, loadProfile]);

  if (!user) return null;

  if (loadingProfile) {
    return (
      <div className="flex justify-center py-8">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!accessToken || !user) return;

    if (!resume.trim() || !direction.trim()) {
      setError('Заполните резюме и направление');
      return;
    }

    setSaving(true);
    setError('');

    try {
      const result = await updateProfile(accessToken, user.id, {
        resume: resume.trim(),
        contacts: { telegram: contactTelegram.trim() },
        direction: direction.trim(),
      });
      setProfile(result.profile);

      if (result.profile.questionnaireCompletedAt && !user.questionnaireCompleted) {
        setUser({ ...user, questionnaireCompleted: true });
      }

      toast.success('Профиль сохранён');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Ошибка сохранения');
    } finally {
      setSaving(false);
    }
  };

  const isCompleted = !!profile?.questionnaireCompletedAt;
  const initials = user.name
    .split(' ')
    .slice(0, 2)
    .map((w: string) => w[0])
    .join('')
    .toUpperCase();

  return (
    <>
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{isCompleted ? 'Мой профиль' : 'Анкета (Задание №0)'}</h1>
          <p className="text-sm text-muted-foreground">{isCompleted ? 'Ваши контактные и профессиональные данные' : 'Заполните для начала обучения'}</p>
        </div>
      </div>

      {/* Приветствие новичку — показываем, пока анкета не заполнена */}
      {!isCompleted && (
        <Card className="mt-4 border-primary/20 bg-primary/5">
          <CardHeader>
            <CardTitle>Рады видеть вас на потоке!</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 text-sm text-muted-foreground">
            <p>
              Вы в личном кабинете школы «Основа»: здесь вы будете проходить уроки,
              выполнять задания и получать обратную связь преподавателя — всё в одном месте.
            </p>
            <p>
              Первый шаг — знакомство. Заполните короткую анкету ниже: расскажите о себе
              и выберите направление. Так преподаватель сразу поймёт, с чего вам начать.
              Обязательны два поля — «Резюме» и «Направление». Поехали!
            </p>
          </CardContent>
        </Card>
      )}

      {/* Avatar + status strip */}
      <Card className="mb-8 mt-4">
        <CardContent className="flex items-center gap-4">
          <div className="flex size-14 flex-shrink-0 items-center justify-center rounded-full border-2 border-primary bg-muted">
            <span className="text-base font-bold tracking-wider text-primary">{initials}</span>
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-base font-semibold text-foreground">{user.name}</p>
            <p className="mt-0.5 text-xs uppercase tracking-widest text-muted-foreground">
              {direction || 'Направление не указано'}
            </p>
          </div>
          {isCompleted && <Badge variant="secondary" className="flex-shrink-0">Анкета заполнена</Badge>}
        </CardContent>
      </Card>

      {/* Validation error */}
      {error && (
        <Alert variant="destructive" className="mb-6">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* Form */}
      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Резюме */}
        <Card>
          <CardHeader>
            <CardTitle>
              Резюме <span className="text-destructive">*</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            <Textarea
              id="resume"
              value={resume}
              onChange={(e) => setResume(e.target.value)}
              placeholder="Краткое профессиональное описание себя"
              rows={4}
            />
            <p className="text-xs text-muted-foreground">Краткое профессиональное описание себя</p>
          </CardContent>
        </Card>

        {/* Контакты */}
        <Card>
          <CardHeader>
            <CardTitle>Контакты</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col gap-2">
              <Label htmlFor="contact-telegram">Telegram</Label>
              <Input
                id="contact-telegram"
                type="text"
                value={contactTelegram}
                onChange={(e) => setContactTelegram(e.target.value)}
                placeholder="@username"
              />
            </div>
          </CardContent>
        </Card>

        {/* Направление */}
        <Card>
          <CardHeader>
            <CardTitle>
              Направление <span className="text-destructive">*</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Input
              id="direction"
              type="text"
              value={direction}
              onChange={(e) => setDirection(e.target.value)}
              placeholder="Специализация в дизайне (UX/UI, графический дизайн, и т.д.)"
            />
          </CardContent>
        </Card>

        {/* Submit */}
        <div className="flex items-center justify-between pt-2">
          <Button type="submit" size="lg" disabled={saving}>
            {saving && <Loader2 className="animate-spin" />}
            {saving ? 'Сохранение...' : isCompleted ? 'Обновить профиль' : 'Отправить анкету'}
          </Button>
          {isCompleted && profile?.questionnaireCompletedAt && (
            <span className="text-xs uppercase tracking-wider text-muted-foreground">
              {new Date(profile.questionnaireCompletedAt).toLocaleDateString('ru-RU')}
            </span>
          )}
        </div>
      </form>
    </>
  );
}
