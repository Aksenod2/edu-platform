'use client';

import Link from 'next/link';
import { Field, FieldLabel } from '@/components/ui/field';
import { StudentCombobox } from '@/components/schedule/student-combobox';
import type { Student } from '@/lib/api';

/**
 * Зависимый блок диалога для режима «Студенту» (встреча 1-на-1).
 *
 * Единственное структурное поле — выбор студента (combobox с серверным поиском).
 * Общее ядро (дата/время/тема) рендерит родитель. При входе с карточки студента
 * этот блок не показывается (студент предвыбран и залочен).
 */
export function MeetingFields({
  accessToken,
  studentId,
  onStudentChange,
  noStudents,
  onNoStudentsChange,
}: {
  accessToken: string;
  studentId: string;
  onStudentChange: (id: string, student: Student | null) => void;
  /** Студентов на платформе нет вовсе — показать подсказку, submit задизейблен. */
  noStudents: boolean;
  onNoStudentsChange: (empty: boolean) => void;
}) {
  if (noStudents) {
    return (
      <div className="rounded-lg border border-dashed bg-muted/30 p-4 text-sm text-muted-foreground">
        Студентов пока нет.{' '}
        <Link
          href="/admin/students"
          className="font-medium text-foreground underline underline-offset-4"
        >
          Добавьте студента
        </Link>
        , чтобы запланировать встречу 1-на-1.
      </div>
    );
  }

  return (
    <Field>
      <FieldLabel htmlFor="plan-student">Студент</FieldLabel>
      <StudentCombobox
        id="plan-student"
        accessToken={accessToken}
        value={studentId}
        onChange={onStudentChange}
        onEmptyChange={onNoStudentsChange}
      />
    </Field>
  );
}
