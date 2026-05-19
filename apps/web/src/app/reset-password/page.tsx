'use client';

import { Suspense, useState, type FormEvent } from 'react';
import { useSearchParams } from 'next/navigation';
import { resetPassword } from '@/lib/api';

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
      setError('Пароль должен быть не менее 6 символов');
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
      <main style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh', fontFamily: 'sans-serif' }}>
        <div style={{ textAlign: 'center' }}>
          <p>Невалидная ссылка для сброса пароля.</p>
          <a href="/login" style={{ color: '#333' }}>Вернуться ко входу</a>
        </div>
      </main>
    );
  }

  return (
    <main style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh', fontFamily: 'sans-serif' }}>
      <form onSubmit={handleSubmit} style={{ width: 360, padding: 32, border: '1px solid #ddd', borderRadius: 8 }}>
        <h1 style={{ fontSize: 24, marginBottom: 24, textAlign: 'center' }}>Новый пароль</h1>

        {done ? (
          <div style={{ textAlign: 'center' }}>
            <p style={{ color: '#060', marginBottom: 16 }}>Пароль успешно изменён!</p>
            <a href="/login" style={{ color: '#333' }}>Войти</a>
          </div>
        ) : (
          <>
            {error && (
              <div style={{ background: '#fee', color: '#c00', padding: 12, borderRadius: 4, marginBottom: 16, fontSize: 14 }}>
                {error}
              </div>
            )}

            <div style={{ marginBottom: 16 }}>
              <label htmlFor="password" style={{ display: 'block', marginBottom: 4, fontSize: 14 }}>Новый пароль</label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={6}
                style={{ width: '100%', padding: 8, border: '1px solid #ccc', borderRadius: 4, boxSizing: 'border-box' }}
              />
            </div>

            <div style={{ marginBottom: 24 }}>
              <label htmlFor="confirmPassword" style={{ display: 'block', marginBottom: 4, fontSize: 14 }}>Подтвердите пароль</label>
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
              disabled={loading}
              style={{
                width: '100%', padding: 10, background: '#333', color: '#fff',
                border: 'none', borderRadius: 4, cursor: loading ? 'not-allowed' : 'pointer', fontSize: 16,
              }}
            >
              {loading ? 'Сохранение...' : 'Сменить пароль'}
            </button>
          </>
        )}
      </form>
    </main>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={
      <main style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh', fontFamily: 'sans-serif' }}>
        <p>Загрузка...</p>
      </main>
    }>
      <ResetPasswordForm />
    </Suspense>
  );
}
