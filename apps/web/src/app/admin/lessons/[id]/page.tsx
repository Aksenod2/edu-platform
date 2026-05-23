'use client';

import { useParams } from 'next/navigation';
import { BackButton } from '@/components/back-button';
import { LessonBlockEditor } from '@/components/lessons/lesson-block-editor';
import { HintCallout } from '@/components/hint-callout';

export default function AdminLessonPage() {
  const params = useParams();
  const lessonId = params.id as string;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <BackButton fallbackHref="/admin/lessons">Назад к Урокам</BackButton>
        <h1 className="text-2xl font-bold tracking-tight">Урок</h1>
        <p className="text-sm text-muted-foreground">
          Переиспользуемый блок: видео, материалы, преподаватели и задание.
          Расписание занятий настраивается в потоке.
        </p>
      </div>

      <HintCallout
        storageKey="eduhint:lesson-editor"
        title="Это шаблон урока, а не занятие в календаре"
      >
        Меняете контент — он обновится во всех потоках, где используется этот
        урок. Чтобы провести урок группе в конкретную дату, откройте поток и
        добавьте занятие в расписании.
      </HintCallout>

      <LessonBlockEditor lessonId={lessonId} />
    </div>
  );
}
