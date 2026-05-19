'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';

export default function Home() {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    if (!user) {
      router.push('/login');
    } else if (user.mustChangePassword) {
      router.push('/change-password');
    } else if (user.role === 'admin') {
      router.push('/admin');
    } else {
      router.push('/dashboard');
    }
  }, [user, loading, router]);

  return (
    <main style={{ padding: '2rem', fontFamily: 'sans-serif' }}>
      <p>Загрузка...</p>
    </main>
  );
}
