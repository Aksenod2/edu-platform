'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { getProfile, updateProfile, type StudentProfile } from '@/lib/api';
import { DashboardLayout, PageHeader } from '@platform/ui/templates';
import { Card, FormField } from '@platform/ui/molecules';
import { Button, Heading, Text, Mono, Spinner, Textarea } from '@platform/ui/atoms';

const STUDENT_NAV = [
  {
    label: 'Обучение',
    items: [
      { label: 'Обзор',      href: '/dashboard',            icon: <GridIcon /> },
      { label: 'Уроки',      href: '/dashboard/lessons',    icon: <BookIcon /> },
      { label: 'Задания',    href: '/dashboard/assignments', icon: <ClipboardIcon /> },
      { label: 'Тред',       href: '/dashboard/thread',     icon: <ChatIcon /> },
      { label: 'Расписание', href: '/dashboard/schedule',   icon: <CalendarIcon /> },
      { label: 'Профиль',    href: '/dashboard/profile',    icon: <UserIcon /> },
    ],
  },
];

export default function ProfilePage() {
  const { user, accessToken, loading, logout, setUser } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

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

  useEffect(() => {
    if (!loading && !user) router.push('/login');
    if (!loading && user?.role === 'admin') router.push('/admin');
    if (!loading && user?.mustChangePassword) router.push('/change-password');
  }, [user, loading, router]);

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

  if (loading || loadingProfile) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh' }}>
        <Spinner size="lg" />
      </div>
    );
  }

  if (!user) return null;

  const isCompleted = !!profile?.questionnaireCompletedAt;

  return (
    <DashboardLayout
      currentPath={pathname}
      header={{
        user: { name: user.name, role: user.role as 'admin' | 'student' },
        onLogout: async () => { await logout(); router.push('/login'); },
      }}
      sidebar={{ sections: STUDENT_NAV }}
    >
      <PageHeader
        title={isCompleted ? 'Мой профиль' : 'Анкета (Задание №0)'}
        subtitle={isCompleted ? 'Ваши контактные и профессиональные данные' : 'Заполните для начала обучения'}
      />

      {!isCompleted && (
        <Card variant="outlined" padding="sm" style={{ borderColor: 'var(--color-warning)', marginBottom: 'var(--space-4)' }}>
          <Text size="sm" color="var(--color-warning)">
            Заполните анкету, чтобы преподаватель знал ваш профессиональный бэкграунд. Все поля обязательны.
          </Text>
        </Card>
      )}

      {error && (
        <Card variant="outlined" padding="sm" style={{ borderColor: 'var(--color-error)', marginBottom: 'var(--space-4)' }}>
          <Text size="sm" color="var(--color-error)">{error}</Text>
        </Card>
      )}

      {message && (
        <Card variant="outlined" padding="sm" style={{ borderColor: 'var(--color-success)', marginBottom: 'var(--space-4)' }}>
          <Text size="sm" color="var(--color-success)">{message}</Text>
        </Card>
      )}

      <Card variant="default" padding="md">
        <form onSubmit={handleSubmit}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
            <FormField
              id="resume"
              label="Резюме"
              required
              hint="Краткое профессиональное описание себя"
            >
              <Textarea
                id="resume"
                value={resume}
                onChange={(e) => setResume(e.target.value)}
                placeholder="Краткое профессиональное описание себя"
                rows={4}
              />
            </FormField>

            <FormField
              id="portfolio"
              label="Портфолио"
              required
              inputProps={{
                type: 'text',
                value: portfolio,
                onChange: (e: React.ChangeEvent<HTMLInputElement>) => setPortfolio(e.target.value),
                placeholder: 'Ссылка на портфолио (Behance, Dribbble, и т.д.)',
              }}
            />

            <FormField
              id="contact-email"
              label="Email для связи"
              required
              inputProps={{
                type: 'email',
                value: contactEmail,
                onChange: (e: React.ChangeEvent<HTMLInputElement>) => setContactEmail(e.target.value),
                placeholder: 'Email',
              }}
            />

            <FormField
              id="contact-telegram"
              label="Telegram"
              inputProps={{
                type: 'text',
                value: contactTelegram,
                onChange: (e: React.ChangeEvent<HTMLInputElement>) => setContactTelegram(e.target.value),
                placeholder: '@username',
              }}
            />

            <FormField
              id="direction"
              label="Направление"
              required
              inputProps={{
                type: 'text',
                value: direction,
                onChange: (e: React.ChangeEvent<HTMLInputElement>) => setDirection(e.target.value),
                placeholder: 'Специализация в дизайне (UX/UI, графический дизайн, и т.д.)',
              }}
            />
          </div>

          <div style={{ marginTop: 'var(--space-6)' }}>
            <Button
              type="submit"
              variant="primary"
              size="lg"
              loading={saving}
            >
              {saving ? 'Сохранение...' : isCompleted ? 'Обновить профиль' : 'Отправить анкету'}
            </Button>
          </div>
        </form>
      </Card>

      {isCompleted && (
        <Mono size="xs" color="var(--color-text-tertiary)" style={{ marginTop: 'var(--space-4)', display: 'block' }}>
          Анкета заполнена {new Date(profile!.questionnaireCompletedAt!).toLocaleDateString('ru-RU')}
        </Mono>
      )}
    </DashboardLayout>
  );
}

// ─── Inline icons ─────────────────────────────────────
function GridIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="1" y="1" width="5" height="5" /><rect x="10" y="1" width="5" height="5" /><rect x="1" y="10" width="5" height="5" /><rect x="10" y="10" width="5" height="5" />
    </svg>
  );
}
function BookIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M3 2h10v12H3z" /><path d="M6 2v12" /><path d="M6 5h4M6 8h4M6 11h4" />
    </svg>
  );
}
function CalendarIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="1" y="3" width="14" height="12" /><path d="M1 7h14M5 1v4M11 1v4" />
    </svg>
  );
}
function UserIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <circle cx="8" cy="5" r="3" /><path d="M2 15c0-3.3 2.7-6 6-6s6 2.7 6 6" />
    </svg>
  );
}
function ChatIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M2 2h12v9H5l-3 3V2z" /><path d="M5 6h6M5 9h3" />
    </svg>
  );
}
function ClipboardIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="3" y="2" width="10" height="13" rx="1" /><path d="M6 1h4v2H6zM6 6h4M6 9h4M6 12h2" />
    </svg>
  );
}
