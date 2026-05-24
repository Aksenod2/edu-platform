'use client';

import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { Eye, Pencil } from 'lucide-react';
import { BackButton } from '@/components/back-button';
import { LessonBlockEditor } from '@/components/lessons/lesson-block-editor';
import { LessonView } from '@/components/lessons/lesson-view';
import { HintCallout } from '@/components/hint-callout';
import { useAuth } from '@/lib/auth-context';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Alert, AlertDescription } from '@/components/ui/alert';

export default function AdminLessonPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const router = useRouter();
  const { user } = useAuth();

  const lessonId = params.id as string;
  // Контекст занятия (поток): ссылки из вкладки потока и календаря несут ?streamId.
  const streamId = searchParams.get('streamId') || undefined;
  // Режим экрана: по умолчанию ПРОСМОТР, редактор — явный ?mode=edit.
  const mode = searchParams.get('mode') === 'edit' ? 'edit' : 'view';

  // Только admin может редактировать — у студентов вообще нет этого роута, но
  // подстраховываемся (роль уже зашита в layout), пряча редактор.
  const canEdit = user?.role === 'admin';

  // Базовый путь урока с сохранением контекста потока (для ссылок между режимами).
  const streamQs = streamId ? `&streamId=${streamId}` : '';
  const viewHref = `/admin/lessons/${lessonId}${streamId ? `?streamId=${streamId}` : ''}`;
  const editHref = `/admin/lessons/${lessonId}?mode=edit${streamQs}`;

  const setMode = (next: 'view' | 'edit') => {
    router.replace(next === 'edit' ? editHref : viewHref, { scroll: false });
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <BackButton fallbackHref="/admin/lessons">Назад к Урокам</BackButton>

        {/* Переключатель Просмотр/Редактирование (состояние в URL). Редактор
            доступен только админу. */}
        {canEdit && (
          <Tabs value={mode} onValueChange={(v) => setMode(v as 'view' | 'edit')}>
            <TabsList>
              <TabsTrigger value="view">
                <Eye className="size-4" />
                Просмотр
              </TabsTrigger>
              <TabsTrigger value="edit">
                <Pencil className="size-4" />
                Редактирование
              </TabsTrigger>
            </TabsList>
          </Tabs>
        )}
      </div>

      {mode === 'edit' && canEdit ? (
        <>
          <div className="flex flex-col gap-1">
            <h1 className="text-2xl font-bold tracking-tight">Редактирование урока</h1>
            <p className="text-sm text-muted-foreground">
              Переиспользуемый блок: видео, материалы, преподаватели и задание.
              Расписание занятий настраивается ниже по потокам.
            </p>
          </div>

          <HintCallout
            storageKey="eduhint:lesson-editor"
            title="Это шаблон урока, а не занятие в календаре"
          >
            Меняете контент — он обновится во всех группах, где используется этот
            урок. Чтобы провести урок группе в конкретную дату, добавьте занятие в
            расписании ниже.
          </HintCallout>

          <LessonBlockEditor lessonId={lessonId} backHref={viewHref} />
        </>
      ) : mode === 'edit' && !canEdit ? (
        <Alert variant="destructive">
          <AlertDescription>
            У вас нет прав на редактирование этого урока.
          </AlertDescription>
        </Alert>
      ) : (
        <LessonView lessonId={lessonId} streamId={streamId} editHref={editHref} />
      )}
    </div>
  );
}
