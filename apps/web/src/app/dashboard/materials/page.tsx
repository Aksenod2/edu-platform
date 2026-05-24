'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { BookOpen, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

/**
 * Раздел «Материалы» слит с «Уроками»: материалы урока теперь живут секцией
 * на странице самого урока. Эта страница оставлена только как редирект, чтобы
 * не ломать старые ссылки на /dashboard/materials — мягко уводим на /dashboard/lessons
 * и показываем короткую заглушку со ссылкой (на случай задержки/отключённого JS).
 */
export default function MaterialsRedirectPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace('/dashboard/lessons');
  }, [router]);

  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <Card className="w-full max-w-md">
        <CardContent className="flex flex-col items-center gap-4 py-10 text-center">
          <div className="flex size-12 items-center justify-center rounded-full bg-muted">
            <BookOpen className="size-6 text-muted-foreground" aria-hidden />
          </div>
          <div className="space-y-1">
            <p className="text-base font-semibold tracking-tight">Материалы теперь в «Уроках»</p>
            <p className="text-sm text-muted-foreground">
              Видео, конспекты и файлы доступны на странице каждого урока.
            </p>
          </div>
          <Button asChild>
            <Link href="/dashboard/lessons">
              Перейти к урокам
              <ArrowRight className="size-4" />
            </Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
