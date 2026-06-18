-- Встречи 1-на-1 (эпик «Встречи 1-на-1», #154). Аддитивная миграция:
-- новый enum MeetingStatus + новая таблица Meeting + индексы + FK на User.
-- Не трогает существующие таблицы/типы/данные; бэкофилл не нужен.

-- CreateEnum
CREATE TYPE "MeetingStatus" AS ENUM ('planned', 'live', 'done', 'cancelled');

-- CreateTable
CREATE TABLE "Meeting" (
    "id" TEXT NOT NULL,
    "teacherId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "title" TEXT,
    "status" "MeetingStatus" NOT NULL DEFAULT 'planned',
    "date" DATE,
    "startTime" TEXT,
    "meetingUrl" TEXT,
    "videoUrl" TEXT,
    "videoKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "zoomMeetingId" TEXT,
    "zoomMeetingUuid" TEXT,
    "recordingStatus" TEXT,
    "recordingError" TEXT,
    "summary" TEXT,
    "summarySource" TEXT,
    "summaryStatus" TEXT,
    "transcriptStatus" TEXT,
    "transcriptVttKey" TEXT,
    "transcriptTxtKey" TEXT,
    "transcriptError" TEXT,
    "transcriptRequestedAt" TIMESTAMP(3),
    "recordingRequestedAt" TIMESTAMP(3),
    "summaryRequestedAt" TIMESTAMP(3),

    CONSTRAINT "Meeting_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Meeting_zoomMeetingId_key" ON "Meeting"("zoomMeetingId");

-- CreateIndex
CREATE INDEX "Meeting_teacherId_idx" ON "Meeting"("teacherId");

-- CreateIndex
CREATE INDEX "Meeting_studentId_idx" ON "Meeting"("studentId");

-- CreateIndex
CREATE INDEX "Meeting_status_date_idx" ON "Meeting"("status", "date");

-- CreateIndex
CREATE INDEX "Meeting_zoomMeetingId_idx" ON "Meeting"("zoomMeetingId");

-- AddForeignKey
ALTER TABLE "Meeting" ADD CONSTRAINT "Meeting_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Meeting" ADD CONSTRAINT "Meeting_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
