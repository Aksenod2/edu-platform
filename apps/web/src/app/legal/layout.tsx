import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import Link from 'next/link';
import { ThemeToggle } from '@/components/theme-toggle';
import { SiteFooter } from '@/components/site-footer';

export const metadata: Metadata = {
  title: 'Правовая информация — OCHOBA',
  description: 'Юридические документы и реквизиты портала OCHOBA',
};

// Публичный layout раздела /legal: БЕЗ авторизации и гардов — оферта и политики
// должны быть доступны любому посетителю ещё до регистрации.
export default function LegalLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-svh flex-col">
      <header className="border-b">
        <div className="mx-auto flex h-14 w-full max-w-2xl items-center justify-between px-6">
          <Link href="/" className="font-semibold tracking-tight">
            OCHOBA
          </Link>
          <ThemeToggle />
        </div>
      </header>
      <main className="mx-auto w-full max-w-2xl flex-1 px-6 py-8 md:py-12">{children}</main>
      <SiteFooter />
    </div>
  );
}
