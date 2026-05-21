'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { Loader2 } from 'lucide-react';

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
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '100vh',
        background: 'var(--color-bg-base)',
      }}
    >
      <Loader2 className="size-8 animate-spin text-muted-foreground" />
    </div>
  );
}
