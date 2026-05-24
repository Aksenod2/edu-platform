import type { FastifyInstance } from 'fastify';
import { prisma } from '@platform/db';
import { requireRole } from '../middleware/auth.js';

export async function statsRoutes(app: FastifyInstance) {
  // Admin-only aggregate dashboard stats
  app.get('/stats', { onRequest: requireRole('admin') }, async () => {
    const now = new Date();
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const weekAhead = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    // Today at 00:00 (schedule dates are stored as @db.Date)
    const todayStart = new Date(now);
    todayStart.setHours(0, 0, 0, 0);

    // Демо/служебные аккаунты (User.isDemo) исключаем из ВСЕХ метрик дашборда: они
    // искусственно завышают количество студентов/активных/новых и засоряют списки
    // «требует внимания». Сам аккаунт рабочий — он виден в ростерах (/users, /streams/:id/students).
    const studentBase = { role: 'student' as const, deletedAt: null, isDemo: false };

    const [
      totalStudents,
      activeStudents,
      blockedStudents,
      newThisWeek,
      pendingOnboardingCount,
      questionnaireIncompleteCount,
      activeStreams,
      archivedStreams,
      assignmentStatusGroups,
      scheduleThisWeek,
      upcomingScheduleRaw,
      submissionsToReviewRaw,
      latestThreadEntries,
      onboardingStudentsRaw,
    ] = await Promise.all([
      // students.total — all non-deleted students
      prisma.user.count({ where: studentBase }),
      // students.active — non-deleted & isActive
      prisma.user.count({ where: { ...studentBase, isActive: true } }),
      // students.blocked — non-deleted & not active
      prisma.user.count({ where: { ...studentBase, isActive: false } }),
      // students.newThisWeek — created within last 7d
      prisma.user.count({ where: { ...studentBase, createdAt: { gte: weekAgo } } }),
      // students.pendingOnboarding — invite not yet accepted (still mustChangePassword)
      prisma.user.count({ where: { ...studentBase, mustChangePassword: true } }),
      // students.questionnaireIncomplete — no profile OR profile not completed
      prisma.user.count({
        where: {
          ...studentBase,
          OR: [
            { studentProfile: null },
            { studentProfile: { questionnaireCompletedAt: null } },
          ],
        },
      }),
      // streams.active
      prisma.stream.count({ where: { status: 'active' } }),
      // streams.archived
      prisma.stream.count({ where: { status: 'archived' } }),
      // assignments.byStatus
      prisma.studentAssignment.groupBy({
        by: ['status'],
        _count: { status: true },
      }),
      // schedule.thisWeek — запланированные сессии на ближайшие 7 дней
      prisma.session.count({
        where: { status: 'planned', date: { gte: todayStart, lte: weekAhead } },
      }),
      // schedule.upcoming — ближайшие 5 запланированных сессий по всем потокам
      prisma.session.findMany({
        where: { status: 'planned', date: { gte: todayStart } },
        orderBy: [{ date: 'asc' }, { startTime: 'asc' }],
        take: 5,
        include: {
          lesson: { select: { title: true } },
          stream: { select: { id: true, name: true } },
        },
      }),
      // TODO (ведущий потока): отсортировать списки «Требует внимания» так, чтобы
      // ученики потоков, где текущий админ — ведущий (stream.ownerId), шли первыми.
      // Не сделано намеренно: затрагивает три разнотипных списка (submissions/threads/
      // onboarding) и горячий endpoint; нужен джойн ученик → enrollment → ownerId.
      // attention.submissionsToReview — status submitted, newest first, top 8
      prisma.studentAssignment.findMany({
        where: { status: 'submitted' },
        orderBy: { submittedAt: 'desc' },
        take: 8,
        select: {
          id: true,
          submittedAt: true,
          student: { select: { id: true, name: true } },
          session: { select: { lesson: { select: { assignmentTitle: true } } } },
        },
      }),
      // attention.unansweredThreads — latest entry per thread; keep threads whose
      // latest entry was authored by the student (awaiting teacher reply).
      // Fetch threads with their newest entry + author role.
      prisma.conversation.findMany({
        where: {
          type: 'student',
          // Демо/служебные аккаунты не учитываем и в «неотвеченных тредах» дашборда.
          student: { deletedAt: null, isDemo: false },
          entries: { some: {} },
        },
        select: {
          studentId: true,
          student: { select: { name: true } },
          entries: {
            orderBy: { createdAt: 'desc' },
            take: 1,
            select: {
              createdAt: true,
              author: { select: { role: true } },
            },
          },
        },
      }),
      // attention.onboarding — invite pending OR questionnaire incomplete, top 8
      prisma.user.findMany({
        where: {
          ...studentBase,
          OR: [
            { mustChangePassword: true },
            { studentProfile: null },
            { studentProfile: { questionnaireCompletedAt: null } },
          ],
        },
        orderBy: { createdAt: 'desc' },
        take: 8,
        select: {
          id: true,
          name: true,
          mustChangePassword: true,
          studentProfile: { select: { questionnaireCompletedAt: true } },
        },
      }),
    ]);

    // Normalize assignment status counts
    const byStatus = {
      assigned: 0,
      submitted: 0,
      reviewed: 0,
      needs_revision: 0,
    };
    for (const group of assignmentStatusGroups) {
      if (group.status in byStatus) {
        byStatus[group.status as keyof typeof byStatus] = group._count.status;
      }
    }

    const upcoming = upcomingScheduleRaw.map((s) => ({
      id: s.id,
      date: s.date,
      startTime: s.startTime,
      lessonTitle: s.lesson.title,
      streamId: s.streamId,
      streamName: s.stream.name,
      meetingUrl: s.meetingUrl,
    }));

    const submissionsToReview = submissionsToReviewRaw.map((s) => ({
      studentAssignmentId: s.id,
      studentId: s.student.id,
      studentName: s.student.name,
      assignmentTitle: s.session.lesson.assignmentTitle,
      submittedAt: s.submittedAt,
    }));

    // Threads awaiting teacher reply: latest entry authored by a student
    const unansweredThreads = latestThreadEntries
      .filter((t) => t.entries[0] && t.entries[0].author.role === 'student')
      .map((t) => ({
        studentId: t.studentId!,
        studentName: t.student?.name ?? '',
        lastEntryAt: t.entries[0].createdAt,
      }))
      .sort((a, b) => b.lastEntryAt.getTime() - a.lastEntryAt.getTime())
      .slice(0, 8);

    const onboarding = onboardingStudentsRaw.map((u) => ({
      studentId: u.id,
      studentName: u.name,
      reason: u.mustChangePassword
        ? ('invite_pending' as const)
        : ('questionnaire_incomplete' as const),
    }));

    return {
      students: {
        total: totalStudents,
        active: activeStudents,
        blocked: blockedStudents,
        newThisWeek,
        pendingOnboarding: pendingOnboardingCount,
        questionnaireIncomplete: questionnaireIncompleteCount,
      },
      streams: {
        active: activeStreams,
        archived: archivedStreams,
      },
      assignments: {
        byStatus,
        awaitingReview: byStatus.submitted,
      },
      schedule: {
        thisWeek: scheduleThisWeek,
        upcoming,
      },
      attention: {
        submissionsToReview,
        unansweredThreads,
        onboarding,
      },
    };
  });
}
