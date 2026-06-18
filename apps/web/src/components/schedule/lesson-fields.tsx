'use client';

import Link from 'next/link';
import { Field, FieldLabel } from '@/components/ui/field';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { MeetingLinkField } from '@/components/schedule/meeting-link-field';
import type { Lesson, LessonStatus, Stream } from '@/lib/api';
import { LESSON_STATUS_LABELS, MANUAL_STATUS_ORDER } from '@/components/schedule/utils';

/** Спец-значение «создать новый урок» в селекте копилки. */
export const NEW_BLOCK = '__new__';

/**
 * Зависимый блок диалога для режима «Группе» (занятие группы).
 *
 * Только структурные поля занятия: поток, урок из копилки / новый, статус, ссылка
 * на созвон (с автогенерацией Zoom). Общее ядро (дата/время/тема) рендерит родитель.
 * Все значения контролируются родителем (PlanEventDialog) — поля сохраняются при
 * переключении сегмента.
 */
export function LessonFields({
  accessToken,
  activeStreams,
  streamLocked,
  streamId,
  onStreamIdChange,
  blockId,
  onBlockIdChange,
  blocks,
  blocksLoading,
  status,
  onStatusChange,
  hasDate,
  notes,
  onNotesChange,
  meetingUrl,
  onMeetingUrlChange,
  generateMeeting,
  onGenerateMeetingChange,
  savedMeetingUrl,
  generationFailed,
}: {
  accessToken: string;
  activeStreams: Stream[];
  /** Поток предзадан и не меняется (вход со страницы группы) — селект скрыт. */
  streamLocked?: boolean;
  streamId: string;
  onStreamIdChange: (v: string) => void;
  blockId: string;
  onBlockIdChange: (v: string) => void;
  blocks: Lesson[];
  blocksLoading: boolean;
  status: LessonStatus;
  onStatusChange: (v: LessonStatus) => void;
  hasDate: boolean;
  notes: string;
  onNotesChange: (v: string) => void;
  meetingUrl: string;
  onMeetingUrlChange: (v: string) => void;
  generateMeeting: boolean;
  onGenerateMeetingChange: (v: boolean) => void;
  savedMeetingUrl: string | null;
  generationFailed: boolean;
}) {
  const plannedWithoutDate = status === 'planned' && !hasDate;
  // Тезисы задаём только для нового урока (у существующего блока — свои тезисы,
  // перезаписывать их при планировании в группу не нужно). Паритет с прежней
  // формой создания из дня календаря (issue #168, замечание ревью).
  const isNewBlock = blockId === NEW_BLOCK;

  // Нет активных групп — планировать занятие некуда. Подсказка + ссылка, поля скрыты.
  // Когда поток залочен (вход со страницы группы), он архивный — отдельный текст
  // без подсказки про сегмент «Студенту» (сегмент в этом режиме скрыт).
  if (activeStreams.length === 0) {
    return (
      <div className="rounded-lg border border-dashed bg-muted/30 p-4 text-sm text-muted-foreground">
        {streamLocked ? (
          <>Группа в архиве — планировать занятия в неё нельзя.</>
        ) : (
          <>
            Активных групп нет.{' '}
            <Link
              href="/admin/streams"
              className="font-medium text-foreground underline underline-offset-4"
            >
              Создайте группу
            </Link>
            , чтобы запланировать занятие. Встречу 1-на-1 можно создать и без группы —
            переключитесь на «Студенту».
          </>
        )}
      </div>
    );
  }

  return (
    <>
      {!streamLocked && (
        <Field>
          <FieldLabel htmlFor="plan-stream">Группа</FieldLabel>
          <Select value={streamId} onValueChange={onStreamIdChange}>
            <SelectTrigger id="plan-stream" className="w-full">
              <SelectValue placeholder="Выберите группу" />
            </SelectTrigger>
            <SelectContent>
              {activeStreams.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      )}

      <Field>
        <FieldLabel htmlFor="plan-block">Урок</FieldLabel>
        <Select value={blockId} onValueChange={onBlockIdChange} disabled={blocksLoading}>
          <SelectTrigger id="plan-block" className="w-full">
            <SelectValue placeholder="Выберите урок" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NEW_BLOCK}>+ Новый урок</SelectItem>
            {blocks.map((b) => (
              <SelectItem key={b.id} value={b.id}>
                {b.title}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {blocksLoading && (
          <p className="text-xs text-muted-foreground">Загрузка списка уроков…</p>
        )}
      </Field>

      <Field>
        <FieldLabel htmlFor="plan-status">Статус</FieldLabel>
        <Select value={status} onValueChange={(v) => onStatusChange(v as LessonStatus)}>
          <SelectTrigger id="plan-status" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {MANUAL_STATUS_ORDER.map((s) => (
              <SelectItem key={s} value={s}>
                {LESSON_STATUS_LABELS[s]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {plannedWithoutDate && (
          <p className="text-xs text-destructive">
            Для статуса «Запланирован» нужно указать дату.
          </p>
        )}
      </Field>

      {isNewBlock && (
        <Field>
          <FieldLabel htmlFor="plan-notes">Тезисы (необязательно)</FieldLabel>
          <Textarea
            id="plan-notes"
            value={notes}
            onChange={(e) => onNotesChange(e.target.value)}
            placeholder="Краткий план или тезисы занятия"
            rows={3}
          />
        </Field>
      )}

      <MeetingLinkField
        accessToken={accessToken}
        inputId="plan-url"
        value={meetingUrl}
        onValueChange={onMeetingUrlChange}
        generateMeeting={generateMeeting}
        onGenerateMeetingChange={onGenerateMeetingChange}
        onConfigLoaded={onGenerateMeetingChange}
        savedMeetingUrl={savedMeetingUrl}
        generationFailed={generationFailed}
      />
    </>
  );
}
