import type { Meeting } from '@/lib/api';
import type { CalendarLesson } from '@/components/schedule-calendar';
import type { LessonStatus } from '@/lib/api';

/** Дефолтная тема встречи, если преподаватель её не указал. */
export const MEETING_FALLBACK_TITLE = 'Встреча 1-на-1';

/**
 * Статус встречи → LessonStatus календаря. Встреча знает planned/live/done/
 * cancelled — все они валидны для LessonStatus (в т.ч. 'live', чтобы идущая
 * встреча показывалась как «идёт»), прочее трактуем как planned.
 */
function meetingStatus(status: string): LessonStatus {
  return status === 'done' ||
    status === 'cancelled' ||
    status === 'planned' ||
    status === 'live'
    ? (status as LessonStatus)
    : 'planned';
}

/**
 * Мапит встречу 1-на-1 в форму CalendarLesson, чтобы показать её в общем
 * календаре/недельном виде рядом с занятиями (с пометкой meeting=true и ссылкой
 * meetingHref на детальную страницу встречи).
 *
 * basePath — роль-зависимый префикс детали встречи:
 *   admin → '/admin/meetings', student → '/dashboard/meetings'.
 */
export function meetingToCalendarLesson(meeting: Meeting, basePath: string): CalendarLesson {
  return {
    id: meeting.id,
    title: meeting.title?.trim() || MEETING_FALLBACK_TITLE,
    status: meetingStatus(meeting.status),
    date: meeting.date,
    startTime: meeting.startTime,
    meetingUrl: meeting.meetingUrl,
    // Поля Lesson, не релевантные встрече, — нейтральные значения.
    videoUrl: null,
    summary: null,
    notes: null,
    sortOrder: 0,
    createdAt: meeting.createdAt,
    updatedAt: meeting.updatedAt,
    recordingStatus: meeting.recordingStatus ?? null,
    recordingError: meeting.recordingError ?? null,
    recordingRequestedAt: meeting.recordingRequestedAt ?? null,
    // Маркеры встречи для календаря/недели.
    meeting: true,
    meetingHref: `${basePath}/${meeting.id}`,
  };
}
