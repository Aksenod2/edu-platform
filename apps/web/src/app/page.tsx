'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { needsConsents, useAuth } from '@/lib/auth-context';
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
    } else if (needsConsents(user)) {
      // Студент без обязательных согласий (зарегистрирован до их появления) — сначала гейт.
      router.push('/consents');
    } else if (user.role === 'admin') {
      router.push('/admin');
    } else {
      router.push('/dashboard');
    }
  }, [user, loading, router]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <Loader2 className="size-8 animate-spin text-muted-foreground" />
    </div>
  );
}
