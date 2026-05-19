'use client';

import { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { acceptInvite } from '@/lib/api';

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
      <main style={{ padding: 32, fontFamily: 'sans-serif', maxWidth: 400, margin: '0 auto' }}>
        <h1>Ошибка</h1>
        <p style={{ color: '#c00' }}>Ссылка приглашения невалидна.</p>
      </main>
    );
  }

  if (success) {
    return (
      <main style={{ padding: 32, fontFamily: 'sans-serif', maxWidth: 400, margin: '0 auto' }}>
        <h1>Готово!</h1>
        <p>Регистрация завершена. Теперь вы можете войти.</p>
        <a href="/login" style={{ color: '#0070f3' }}>Перейти на страницу входа</a>
      </main>
    );
  }

  return (
    <main style={{ padding: 32, fontFamily: 'sans-serif', maxWidth: 400, margin: '0 auto' }}>
      <h1>Регистрация</h1>
      <p style={{ color: '#666', marginBottom: 16 }}>Установите пароль для входа на платформу.</p>

      {error && (
        <div style={{ padding: '8px 12px', background: '#fee', color: '#c00', borderRadius: 4, marginBottom: 16 }}>
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit}>
        <div style={{ marginBottom: 12 }}>
          <label style={{ display: 'block', marginBottom: 4, fontSize: 14 }}>Пароль</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={6}
            style={{ width: '100%', padding: '8px 10px', border: '1px solid #ccc', borderRadius: 4, boxSizing: 'border-box' }}
          />
        </div>
        <div style={{ marginBottom: 16 }}>
          <label style={{ display: 'block', marginBottom: 4, fontSize: 14 }}>Подтвердите пароль</label>
          <input
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            required
            minLength={6}
            style={{ width: '100%', padding: '8px 10px', border: '1px solid #ccc', borderRadius: 4, boxSizing: 'border-box' }}
          />
        </div>
        <button
          type="submit"
          disabled={loading}
          style={{ width: '100%', padding: '10px', background: '#0070f3', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: 16 }}
        >
          {loading ? 'Регистрация...' : 'Зарегистрироваться'}
        </button>
      </form>
    </main>
  );
}

export default function InvitePage() {
  return (
    <Suspense fallback={
      <main style={{ padding: 32, fontFamily: 'sans-serif', maxWidth: 400, margin: '0 auto' }}>
        <p>Загрузка...</p>
      </main>
    }>
      <InviteForm />
    </Suspense>
  );
}
