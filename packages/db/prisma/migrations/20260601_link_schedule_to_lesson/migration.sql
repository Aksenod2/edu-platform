ALTER TABLE "ScheduleEntry" ADD COLUMN "lessonId" TEXT;
CREATE INDEX "ScheduleEntry_lessonId_idx" ON "ScheduleEntry"("lessonId");
ALTER TABLE "ScheduleEntry" ADD CONSTRAINT "ScheduleEntry_lessonId_fkey" FOREIGN KEY ("lessonId") REFERENCES "Lesson"("id") ON DELETE SET NULL ON UPDATE CASCADE;
