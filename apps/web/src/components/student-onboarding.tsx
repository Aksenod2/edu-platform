'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { CheckCircle2, Circle, X } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

// Лёгкий онбординг студента: чек-лист «Первые шаги» на главной.
// Статусы шагов — из реальных данных; «открыл урок» и «скрыто» — в localStorage
// (по userId). Карточка исчезает, когда всё выполнено или её скрыли.
type Props = {
  userId: string;
  questionnaireCompleted: boolean;
  hasSubmitted: boolean;
};

export function StudentOnboarding({ userId, questionnaireCompleted, hasSubmitted }: Props) {
  const [mounted, setMounted] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [lessonOpened, setLessonOpened] = useState(false);

  const dismissKey = `onboarding_dismissed_${userId}`;
  const lessonKey = `onboarding_lesson_${userId}`;

  // localStorage доступен только на клиенте — читаем после монтирования.
  useEffect(() => {
    setDismissed(localStorage.getItem(dismissKey) === '1');
    setLessonOpened(localStorage.getItem(lessonKey) === '1');
    setMounted(true);
  }, [dismissKey, lessonKey]);

  const steps = [
    { label: 'Заполните анкету', done: questionnaireCompleted, href: '/dashboard/profile' },
    {
      label: 'Откройте первый урок',
      done: lessonOpened,
      href: '/dashboard/lessons',
      markLesson: true,
    },
    { label: 'Сдайте первое задание', done: hasSubmitted, href: '/dashboard/assignments' },
  ];

  const doneCount = steps.filter((s) => s.done).length;

  // До монтирования (чтобы не было hydration mismatch), если скрыто или всё пройдено — не показываем.
  if (!mounted || dismissed || doneCount === steps.length) return null;

  const handleDismiss = () => {
    localStorage.setItem(dismissKey, '1');
    setDismissed(true);
  };

  const handleLessonClick = () => {
    localStorage.setItem(lessonKey, '1');
    setLessonOpened(true);
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-2 space-y-0">
        <div>
          <CardTitle>Первые шаги</CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">
            Выполнено {doneCount} из {steps.length}
          </p>
        </div>
        <Button variant="ghost" size="icon" onClick={handleDismiss} aria-label="Скрыть">
          <X />
        </Button>
      </CardHeader>
      <CardContent className="flex flex-col gap-1">
        {steps.map((step) => (
          <Link
            key={step.href}
            href={step.href}
            onClick={step.markLesson ? handleLessonClick : undefined}
            className="flex items-center gap-3 rounded-md px-2 py-2 no-underline transition-colors hover:bg-accent"
          >
            {step.done ? (
              <CheckCircle2 className="size-5 shrink-0 text-success" />
            ) : (
              <Circle className="size-5 shrink-0 text-muted-foreground" />
            )}
            <span
              className={
                step.done
                  ? 'text-sm text-muted-foreground line-through'
                  : 'text-sm font-medium'
              }
            >
              {step.label}
            </span>
          </Link>
        ))}
      </CardContent>
    </Card>
  );
}
