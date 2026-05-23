'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { LessonBlockEditor } from '@/components/lessons/lesson-block-editor';

export default function AdminLessonPage() {
  const params = useParams();
  const lessonId = params.id as string;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Button variant="ghost" size="sm" className="-ml-2 w-fit" asChild>
          <Link href="/admin/lessons">
            <ArrowLeft />
            Назад к Урокам
          </Link>
        </Button>
        <h1 className="text-2xl font-bold tracking-tight">Урок</h1>
        <p className="text-sm text-muted-foreground">
          Переиспользуемый блок: видео, материалы, преподаватели и задание.
          Расписание занятий настраивается в потоке.
        </p>
      </div>

      <LessonBlockEditor lessonId={lessonId} />
    </div>
  );
}
