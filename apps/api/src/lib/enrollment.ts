import { prisma } from '@platform/db';

/**
 * Проверяет, зачислен ли пользователь на поток.
 * Используется для ограничения доступа студентов к чужим потокам.
 */
export async function isEnrolled(userId: string, streamId: string): Promise<boolean> {
  const enrollment = await prisma.streamEnrollment.findUnique({
    where: { streamId_userId: { streamId, userId } },
  });
  return enrollment !== null;
}
