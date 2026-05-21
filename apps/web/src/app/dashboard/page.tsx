'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/lib/auth-context';
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

const QUICK_LINKS = [
  { title: 'Уроки', description: 'Видеозаписи, конспекты, материалы', href: '/dashboard/lessons' },
  { title: 'Задания', description: 'Назначенные задания и их статусы', href: '/dashboard/assignments' },
  { title: 'Тред', description: 'Записи, файлы, обратная связь', href: '/dashboard/thread' },
  { title: 'Расписание', description: 'Предстоящие занятия и сроки', href: '/dashboard/schedule' },
  { title: 'Профиль', description: 'Анкета и контактные данные', href: '/dashboard/profile' },
];

export default function DashboardPage() {
  const { user } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (user?.role === 'student' && user.questionnaireCompleted === false) {
      router.push('/dashboard/profile');
    }
  }, [user, router]);

  const firstName = user?.name.split(' ')[0] ?? '';

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Привет, {firstName}</h1>
        <p className="text-sm text-muted-foreground">Ваш учебный дашборд</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {QUICK_LINKS.map((link) => (
          <Link key={link.href} href={link.href} className="no-underline">
            <Card className="h-full transition-colors hover:border-primary/40 hover:bg-accent/40">
              <CardHeader>
                <CardTitle>{link.title}</CardTitle>
                <CardDescription>{link.description}</CardDescription>
              </CardHeader>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
