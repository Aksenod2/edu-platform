'use client';

import { useEffect, useState, useCallback } from 'react';
import { useAuth } from '@/lib/auth-context';
import { Loader2 } from 'lucide-react';
import { getProfile, updateProfile, type StudentProfile } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Alert, AlertDescription } from '@/components/ui/alert';

export default function ProfilePage() {
  const { user, accessToken, setUser } = useAuth();

  const [profile, setProfile] = useState<StudentProfile | null>(null);
  const [loadingProfile, setLoadingProfile] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const [resume, setResume] = useState('');
  const [portfolio, setPortfolio] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [contactTelegram, setContactTelegram] = useState('');
  const [direction, setDirection] = useState('');

  const loadProfile = useCallback(async () => {
    if (!accessToken || !user) return;
    try {
      const data = await getProfile(accessToken, user.id);
      setProfile(data.profile);
      if (data.profile) {
        setResume(data.profile.resume || '');
        setPortfolio(data.profile.portfolio || '');
        setContactEmail(data.profile.contacts?.email || '');
        setContactTelegram(data.profile.contacts?.telegram || '');
        setDirection(data.profile.direction || '');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка загрузки профиля');
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
        <div className="size-6 animate-spin rounded-full border-2 border-border border-t-primary" />
      </div>
    );
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!accessToken || !user) return;

    if (!resume.trim() || !portfolio.trim() || !contactEmail.trim() || !direction.trim()) {
      setError('Все поля обязательны для заполнения');
      return;
    }

    setSaving(true);
    setError('');
    setMessage('');

    try {
      const result = await updateProfile(accessToken, user.id, {
        resume: resume.trim(),
        portfolio: portfolio.trim(),
        contacts: { email: contactEmail.trim(), telegram: contactTelegram.trim() },
        direction: direction.trim(),
      });
      setProfile(result.profile);

      if (result.profile.questionnaireCompletedAt && !user.questionnaireCompleted) {
        setUser({ ...user, questionnaireCompleted: true });
      }

      setMessage('Профиль сохранён');
      setTimeout(() => setMessage(''), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка сохранения');
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

      {/* Avatar + status strip */}
      <div className="flex items-center gap-4 mb-8 p-5 border border-[var(--color-border-default)] bg-[var(--color-bg-surface)]">
        <div className="flex-shrink-0 w-14 h-14 rounded-full border-2 border-[var(--color-accent-red)] flex items-center justify-center bg-[var(--color-bg-elevated)]">
          <span className="font-mono text-base font-bold text-[var(--color-accent-red)] tracking-wider">
            {initials}
          </span>
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-sans text-base font-semibold text-[var(--color-text-primary)] truncate">{user.name}</p>
          <p className="font-mono text-xs text-[var(--color-text-tertiary)] uppercase tracking-widest mt-0.5">
            {direction || 'Направление не указано'}
          </p>
        </div>
        {isCompleted && (
          <span className="flex-shrink-0 px-2 py-1 border border-[var(--color-accent-neon)] font-mono text-xs text-[var(--color-accent-neon)] uppercase tracking-wider">
            Анкета заполнена
          </span>
        )}
      </div>

      {/* Warning */}
      {!isCompleted && (
        <div className="mb-6 px-4 py-3 border border-[var(--color-warning)] bg-[var(--color-warning-dim)] flex items-start gap-3">
          <svg className="flex-shrink-0 mt-0.5 text-[var(--color-warning)]" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M8 1L15 14H1L8 1z" />
            <path d="M8 6v4" strokeLinecap="round" />
            <circle cx="8" cy="12.5" r="0.5" fill="currentColor" stroke="none" />
          </svg>
          <p className="font-sans text-sm text-[var(--color-warning)] leading-relaxed">
            Заполните анкету, чтобы преподаватель знал ваш профессиональный бэкграунд. Все поля обязательны.
          </p>
        </div>
      )}

      {/* Error */}
      {error && (
        <Alert variant="destructive" className="mb-6 flex items-center justify-between gap-3">
          <AlertDescription>{error}</AlertDescription>
          <button onClick={() => setError('')} className="flex-shrink-0 hover:opacity-70 transition-opacity">
            <CloseIcon />
          </button>
        </Alert>
      )}

      {/* Success */}
      {message && (
        <Alert className="mb-6">
          <AlertDescription>{message}</AlertDescription>
        </Alert>
      )}

      {/* Form */}
      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Резюме */}
        <div className="border border-[var(--color-border-default)] bg-[var(--color-bg-surface)] p-5">
          <label htmlFor="resume" className="block font-mono text-xs uppercase tracking-widest text-[var(--color-text-tertiary)] mb-3">
            Резюме <span className="text-[var(--color-accent-red)]">*</span>
          </label>
          <Textarea
            id="resume"
            value={resume}
            onChange={(e) => setResume(e.target.value)}
            placeholder="Краткое профессиональное описание себя"
            rows={4}
          />
          <p className="mt-2 font-sans text-xs text-[var(--color-text-disabled)]">Краткое профессиональное описание себя</p>
        </div>

        {/* Портфолио */}
        <div className="border border-[var(--color-border-default)] bg-[var(--color-bg-surface)] p-5">
          <label htmlFor="portfolio" className="block font-mono text-xs uppercase tracking-widest text-[var(--color-text-tertiary)] mb-3">
            Портфолио <span className="text-[var(--color-accent-red)]">*</span>
          </label>
          <Input
            id="portfolio"
            type="text"
            value={portfolio}
            onChange={(e) => setPortfolio(e.target.value)}
            placeholder="Ссылка на портфолио (Behance, Dribbble, и т.д.)"
          />
        </div>

        {/* Контакты */}
        <div className="border border-[var(--color-border-default)] bg-[var(--color-bg-surface)] p-5">
          <p className="font-mono text-xs uppercase tracking-widest text-[var(--color-text-tertiary)] mb-4">
            Контакты
          </p>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="contact-email" className="block font-mono text-xs text-[var(--color-text-secondary)] mb-2">
                Email <span className="text-[var(--color-accent-red)]">*</span>
              </label>
              <Input
                id="contact-email"
                type="email"
                value={contactEmail}
                onChange={(e) => setContactEmail(e.target.value)}
                placeholder="email@example.com"
              />
            </div>
            <div>
              <label htmlFor="contact-telegram" className="block font-mono text-xs text-[var(--color-text-secondary)] mb-2">
                Telegram
              </label>
              <Input
                id="contact-telegram"
                type="text"
                value={contactTelegram}
                onChange={(e) => setContactTelegram(e.target.value)}
                placeholder="@username"
              />
            </div>
          </div>
        </div>

        {/* Направление */}
        <div className="border border-[var(--color-border-default)] bg-[var(--color-bg-surface)] p-5">
          <label htmlFor="direction" className="block font-mono text-xs uppercase tracking-widest text-[var(--color-text-tertiary)] mb-3">
            Направление <span className="text-[var(--color-accent-red)]">*</span>
          </label>
          <Input
            id="direction"
            type="text"
            value={direction}
            onChange={(e) => setDirection(e.target.value)}
            placeholder="Специализация в дизайне (UX/UI, графический дизайн, и т.д.)"
          />
        </div>

        {/* Submit */}
        <div className="flex items-center justify-between pt-2">
          <Button type="submit" size="lg" disabled={saving}>
            {saving && <Loader2 className="animate-spin" />}
            {saving ? 'Сохранение...' : isCompleted ? 'Обновить профиль' : 'Отправить анкету'}
          </Button>
          {isCompleted && profile?.questionnaireCompletedAt && (
            <span className="font-mono text-xs text-[var(--color-text-disabled)] uppercase tracking-wider">
              {new Date(profile.questionnaireCompletedAt).toLocaleDateString('ru-RU')}
            </span>
          )}
        </div>
      </form>
    </>
  );
}

// ─── Icons ─────────────────────────────────────────────────
function CloseIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <path d="M4 4l8 8M12 4l-8 8" />
    </svg>
  );
}
