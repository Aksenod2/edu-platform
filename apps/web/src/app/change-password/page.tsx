'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
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

  if (loading) return <p style={{ padding: 32, fontFamily: 'sans-serif' }}>Загрузка...</p>;
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
      setError('Новый пароль должен быть не менее 6 символов');
      return;
    }

    setSubmitting(true);
    try {
      const result = await changePassword(accessToken!, currentPassword, newPassword);
      setAccessToken(result.accessToken);
      setUser({ ...user!, mustChangePassword: false });
      if (user!.role === 'admin') {
        router.push('/admin');
      } else {
        router.push('/dashboard');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка смены пароля');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh', fontFamily: 'sans-serif' }}>
      <form onSubmit={handleSubmit} style={{ width: 360, padding: 32, border: '1px solid #ddd', borderRadius: 8 }}>
        <h1 style={{ fontSize: 24, marginBottom: 8, textAlign: 'center' }}>Смена пароля</h1>
        {user.mustChangePassword && (
          <p style={{ fontSize: 14, color: '#666', textAlign: 'center', marginBottom: 24 }}>
            Необходимо сменить пароль перед началом работы
          </p>
        )}

        {error && (
          <div style={{ background: '#fee', color: '#c00', padding: 12, borderRadius: 4, marginBottom: 16, fontSize: 14, userSelect: 'text', cursor: 'text' }}>
            {error}
          </div>
        )}

        <div style={{ marginBottom: 16 }}>
          <label htmlFor="currentPassword" style={{ display: 'block', marginBottom: 4, fontSize: 14 }}>Текущий пароль</label>
          <input
            id="currentPassword"
            type="password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            required
            style={{ width: '100%', padding: 8, border: '1px solid #ccc', borderRadius: 4, boxSizing: 'border-box' }}
          />
        </div>

        <div style={{ marginBottom: 16 }}>
          <label htmlFor="newPassword" style={{ display: 'block', marginBottom: 4, fontSize: 14 }}>Новый пароль</label>
          <input
            id="newPassword"
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            required
            minLength={6}
            style={{ width: '100%', padding: 8, border: '1px solid #ccc', borderRadius: 4, boxSizing: 'border-box' }}
          />
        </div>

        <div style={{ marginBottom: 24 }}>
          <label htmlFor="confirmPassword" style={{ display: 'block', marginBottom: 4, fontSize: 14 }}>Подтвердите новый пароль</label>
          <input
            id="confirmPassword"
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            required
            minLength={6}
            style={{ width: '100%', padding: 8, border: '1px solid #ccc', borderRadius: 4, boxSizing: 'border-box' }}
          />
        </div>

        <button
          type="submit"
          disabled={submitting}
          style={{
            width: '100%', padding: 10, background: '#333', color: '#fff',
            border: 'none', borderRadius: 4, cursor: submitting ? 'not-allowed' : 'pointer', fontSize: 16,
          }}
        >
          {submitting ? 'Сохранение...' : 'Сменить пароль'}
        </button>
      </form>
    </main>
  );
}
