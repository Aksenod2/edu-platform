'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';

export default function DashboardPage() {
  const { user, loading, logout } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !user) {
      router.push('/login');
    }
    if (!loading && user?.role === 'admin') {
      router.push('/admin');
    }
    if (!loading && user?.mustChangePassword) {
      router.push('/change-password');
    }
  }, [user, loading, router]);

  if (loading) return <p style={{ padding: 32, fontFamily: 'sans-serif' }}>Загрузка...</p>;
  if (!user) return null;

  return (
    <main style={{ padding: 32, fontFamily: 'sans-serif' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <h1>Личный кабинет</h1>
        <button
          onClick={async () => { await logout(); router.push('/login'); }}
          style={{ padding: '8px 16px', background: '#eee', border: '1px solid #ccc', borderRadius: 4, cursor: 'pointer' }}
        >
          Выйти
        </button>
      </div>
      <p>Добро пожаловать, {user.name}!</p>

      <nav style={{ marginTop: 24 }}>
        <h2 style={{ fontSize: 18, marginBottom: 12 }}>Разделы</h2>
        <ul style={{ listStyle: 'none', padding: 0, display: 'flex', gap: 12 }}>
          <li>
            <a
              href="/dashboard/lessons"
              style={{ display: 'block', padding: '12px 20px', background: '#f5f5f5', border: '1px solid #ddd', borderRadius: 6, textDecoration: 'none', color: '#333' }}
            >
              Уроки
            </a>
          </li>
          <li>
            <a
              href="/dashboard/schedule"
              style={{ display: 'block', padding: '12px 20px', background: '#f5f5f5', border: '1px solid #ddd', borderRadius: 6, textDecoration: 'none', color: '#333' }}
            >
              Расписание
            </a>
          </li>
        </ul>
      </nav>
    </main>
  );
}
