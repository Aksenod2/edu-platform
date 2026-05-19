'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { getProfile, updateProfile, type StudentProfile } from '@/lib/api';

export default function ProfilePage() {
  const { user, accessToken, loading, setUser } = useAuth();
  const router = useRouter();

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
    return <p style={{ padding: 32, fontFamily: 'sans-serif' }}>Загрузка...</p>;
  }
  if (!user) return null;

  const isCompleted = !!profile?.questionnaireCompletedAt;

  return (
    <main style={{ padding: 32, fontFamily: 'sans-serif', maxWidth: 640, margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <h1>{isCompleted ? 'Мой профиль' : 'Анкета (Задание №0)'}</h1>
        <a href="/dashboard" style={{ color: '#666', textDecoration: 'none' }}>
          ← Назад
        </a>
      </div>

      {!isCompleted && (
        <div style={{ background: '#fff3cd', border: '1px solid #ffc107', borderRadius: 6, padding: 12, marginBottom: 20 }}>
          Заполните анкету, чтобы преподаватель знал ваш профессиональный бэкграунд. Все поля обязательны.
        </div>
      )}

      {error && (
        <div style={{ background: '#f8d7da', border: '1px solid #dc3545', borderRadius: 6, padding: 12, marginBottom: 16, color: '#721c24' }}>
          {error}
        </div>
      )}
      {message && (
        <div style={{ background: '#d4edda', border: '1px solid #28a745', borderRadius: 6, padding: 12, marginBottom: 16, color: '#155724' }}>
          {message}
        </div>
      )}

      <form onSubmit={handleSubmit}>
        <div style={{ marginBottom: 16 }}>
          <label style={{ display: 'block', marginBottom: 4, fontWeight: 600 }}>
            Резюме <span style={{ color: '#dc3545' }}>*</span>
          </label>
          <textarea
            value={resume}
            onChange={(e) => setResume(e.target.value)}
            placeholder="Краткое профессиональное описание себя"
            rows={4}
            style={{ width: '100%', padding: 8, border: '1px solid #ccc', borderRadius: 4, fontFamily: 'sans-serif', boxSizing: 'border-box' }}
          />
        </div>

        <div style={{ marginBottom: 16 }}>
          <label style={{ display: 'block', marginBottom: 4, fontWeight: 600 }}>
            Портфолио <span style={{ color: '#dc3545' }}>*</span>
          </label>
          <input
            type="text"
            value={portfolio}
            onChange={(e) => setPortfolio(e.target.value)}
            placeholder="Ссылка на портфолио (Behance, Dribbble, и т.д.)"
            style={{ width: '100%', padding: 8, border: '1px solid #ccc', borderRadius: 4, boxSizing: 'border-box' }}
          />
        </div>

        <div style={{ marginBottom: 16 }}>
          <label style={{ display: 'block', marginBottom: 4, fontWeight: 600 }}>
            Email для связи <span style={{ color: '#dc3545' }}>*</span>
          </label>
          <input
            type="email"
            value={contactEmail}
            onChange={(e) => setContactEmail(e.target.value)}
            placeholder="Email"
            style={{ width: '100%', padding: 8, border: '1px solid #ccc', borderRadius: 4, boxSizing: 'border-box' }}
          />
        </div>

        <div style={{ marginBottom: 16 }}>
          <label style={{ display: 'block', marginBottom: 4, fontWeight: 600 }}>
            Telegram
          </label>
          <input
            type="text"
            value={contactTelegram}
            onChange={(e) => setContactTelegram(e.target.value)}
            placeholder="@username"
            style={{ width: '100%', padding: 8, border: '1px solid #ccc', borderRadius: 4, boxSizing: 'border-box' }}
          />
        </div>

        <div style={{ marginBottom: 24 }}>
          <label style={{ display: 'block', marginBottom: 4, fontWeight: 600 }}>
            Направление <span style={{ color: '#dc3545' }}>*</span>
          </label>
          <input
            type="text"
            value={direction}
            onChange={(e) => setDirection(e.target.value)}
            placeholder="Специализация в дизайне (UX/UI, графический дизайн, и т.д.)"
            style={{ width: '100%', padding: 8, border: '1px solid #ccc', borderRadius: 4, boxSizing: 'border-box' }}
          />
        </div>

        <button
          type="submit"
          disabled={saving}
          style={{
            padding: '10px 24px',
            background: saving ? '#ccc' : '#333',
            color: '#fff',
            border: 'none',
            borderRadius: 4,
            cursor: saving ? 'default' : 'pointer',
            fontSize: 16,
          }}
        >
          {saving ? 'Сохранение...' : isCompleted ? 'Обновить профиль' : 'Отправить анкету'}
        </button>
      </form>

      {isCompleted && (
        <p style={{ marginTop: 16, color: '#666', fontSize: 14 }}>
          Анкета заполнена {new Date(profile!.questionnaireCompletedAt!).toLocaleDateString('ru-RU')}
        </p>
      )}
    </main>
  );
}
