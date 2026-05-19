'use client';

import { useState, type FormEvent } from 'react';
import { forgotPassword } from '@/lib/api';

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

  return (
    <main style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh', fontFamily: 'sans-serif' }}>
      <form onSubmit={handleSubmit} style={{ width: 360, padding: 32, border: '1px solid #ddd', borderRadius: 8 }}>
        <h1 style={{ fontSize: 24, marginBottom: 24, textAlign: 'center' }}>Сброс пароля</h1>

        {sent ? (
          <div style={{ textAlign: 'center' }}>
            <p style={{ color: '#060', marginBottom: 16 }}>Если аккаунт существует, письмо со ссылкой отправлено на {email}</p>
            <a href="/login" style={{ color: '#333' }}>Вернуться ко входу</a>
          </div>
        ) : (
          <>
            {error && (
              <div style={{ background: '#fee', color: '#c00', padding: 12, borderRadius: 4, marginBottom: 16, fontSize: 14 }}>
                {error}
              </div>
            )}

            <div style={{ marginBottom: 24 }}>
              <label htmlFor="email" style={{ display: 'block', marginBottom: 4, fontSize: 14 }}>Email</label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
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
              {loading ? 'Отправка...' : 'Отправить ссылку'}
            </button>

            <div style={{ textAlign: 'center', marginTop: 16, fontSize: 14 }}>
              <a href="/login" style={{ color: '#666' }}>Вернуться ко входу</a>
            </div>
          </>
        )}
      </form>
    </main>
  );
}
